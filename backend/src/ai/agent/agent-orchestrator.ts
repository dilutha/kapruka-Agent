/**
 * Agent Orchestrator
 *
 * Implements the Kapruka shopping agent as a LangGraph StateGraph.
 *
 * State machine topology:
 *
 *   [START]
 *     │
 *     ▼
 *   language_detector  ← normalizes to EN before classification
 *     │
 *     ▼
 *   intent_classifier  ← Gemini structured output
 *     │
 *     ├── SEARCH       → product_search_agent
 *     ├── RECOMMEND    → recommendation_agent
 *     ├── CHECKOUT     → checkout_agent
 *     ├── TRACK        → tracking_agent
 *     ├── GIFT         → gift_agent
 *     └── CHITCHAT     → general_response_agent
 *                             │
 *                             ▼
 *                       [response_formatter]
 *                             │
 *                             ▼
 *                           [END]
 *
 * Each agent node:
 *  1. Receives the shared AgentState
 *  2. Calls one or more MCP tools
 *  3. Generates a response grounded in tool results
 *  4. Updates state (cart, product context, etc.)
 *  5. Returns streaming tokens
 */

import { Injectable, Logger } from '@nestjs/common';
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ToolMessage } from '@langchain/core/messages';

import { McpClientService } from '../../mcp/mcp-client.service';
import { GeminiService, GeminiMessage } from '../gemini/gemini.service';
import { PromptLibrary } from './prompts/prompt-library';
import { IntentClassifier } from './nodes/intent-classifier.node';
import { ProductSearchNode } from './nodes/product-search.node';
import { RecommendationNode } from './nodes/recommendation.node';
import { CheckoutNode } from './nodes/checkout.node';
import { TrackingNode } from './nodes/tracking.node';
import { GiftNode } from './nodes/gift.node';
import { Language, MessageRole as PrismaMessageRole } from '@prisma/client';

import type {
  Address,
  CartItem,
  CheckoutStep,
  GiftMessageInput,
  KaprukProduct,
  OrderSummary,
  PersistedAgentState,
} from './state/agent-state.schema';

/**
 * Re-exported so consumers keep importing agent domain types from the
 * orchestrator, while the definitions (and their runtime validators) live in
 * `state/agent-state.schema.ts`.
 */
export type {
  Address,
  CartItem,
  CheckoutStep,
  GiftMessageInput,
  KaprukProduct,
  OrderSummary,
  PersistedAgentState,
} from './state/agent-state.schema';

// ─── Agent State Schema ───────────────────────────────────────────────────────

/**
 * Shared state flowing through all LangGraph nodes.
 * Each node can read and update any field.
 * State is persisted to Redis between turns.
 */
export const AgentStateAnnotation = Annotation.Root({
  chatId: Annotation<string>(),
  userId: Annotation<string | undefined>(),
  language: Annotation<Language>(),

  // Conversation history (last 20 messages for context window)
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, update) => [...curr, ...update],
    default: () => [],
  }),

  // Detected intent from classifier
  intent: Annotation<Intent | undefined>(),
  intentConfidence: Annotation<number>(),

  // Product context
  searchQuery: Annotation<string | undefined>(),
  searchResults: Annotation<KaprukProduct[]>({
    reducer: (_, update) => update, // Replace, don't accumulate
    default: () => [],
  }),
  selectedProduct: Annotation<KaprukProduct | undefined>(),

  // Gift-finder context (extracted by IntentClassifier for RECOMMEND/GIFT)
  occasion: Annotation<string | undefined>(),
  budget: Annotation<number | undefined>(),

  // Cart context (mirrors Kapruka cart state)
  cartItems: Annotation<CartItem[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // Checkout context
  shippingAddress: Annotation<Address | undefined>(),
  giftMessage: Annotation<GiftMessageInput | undefined>(),
  /** YYYY-MM-DD delivery date, validated via `kapruka_check_delivery`. */
  deliveryDate: Annotation<string | undefined>(),
  /** Which field the conversational checkout flow is currently collecting. */
  checkoutStep: Annotation<CheckoutStep | undefined>(),
  /** Real Kapruka click-to-pay link, once `kapruka_create_order` succeeds. */
  checkoutUrl: Annotation<string | undefined>(),
  orderSummary: Annotation<OrderSummary | undefined>(),

  // Order context (for tracking) — the pre-payment `order_ref` from
  // `kapruka_create_order` (checkoutUrl above), NOT the post-payment order
  // number `kapruka_track_order` expects (see tracking.node.ts).
  orderRef: Annotation<string | undefined>(),

  // Response being built
  response: Annotation<string>(),
  responseType: Annotation<ResponseType>(),

  // Tool call results (raw, for grounding)
  toolResults: Annotation<ToolResult[]>({
    reducer: (curr, update) => [...curr, ...update],
    default: () => [],
  }),

  // Error handling
  lastError: Annotation<AgentError | undefined>(),
  retryCount: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

// ─── Intent types ─────────────────────────────────────────────────────────────

export type Intent =
  | 'SEARCH'
  | 'RECOMMEND'
  | 'CHECKOUT'
  | 'TRACK'
  | 'GIFT'
  | 'ADD_TO_CART'
  | 'REMOVE_FROM_CART'
  | 'CHITCHAT'
  | 'LANGUAGE_SWITCH';

export type ResponseType =
  | 'text'
  | 'product_list'
  | 'cart'
  | 'order_status'
  | 'checkout';

interface ToolResult {
  toolName: string;
  result: unknown;
  timestamp: number;
}

interface AgentError {
  code: string;
  message: string;
  isRetryable: boolean;
}

// ─── Streaming chunk types (yielded to controller) ────────────────────────────

export type StreamChunk =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; toolCall: unknown }
  | { type: 'tool_result'; result: unknown }
  | {
      type: 'checkout_ready';
      orderRef: string;
      checkoutUrl: string;
      summary: OrderSummary;
    }
  | { type: 'state_update'; state: PersistedAgentState }
  | { type: 'error'; code: string; message: string };

interface GraphStreamEvent {
  event: string;
  name?: string;
  data?: {
    chunk?: { content?: unknown };
    input?: unknown;
    output?: unknown;
  };
}

/**
 * The leaf nodes `buildGraph()` wires directly to `END` (must stay in sync
 * with the `.addEdge(<name>, END)` calls there, and with the keys of
 * `buildConditionalMap()`). `streamMessage()` uses this to recognize which
 * `on_chain_end` event carries the turn's actual final state — LangGraph's
 * own top-level `on_chain_end` fires under the compiled graph's internal
 * wrapper name (e.g. "LangGraph"), never `"__end__"`, so matching on these
 * node names is what makes state capture independent of that library detail.
 */
const TERMINAL_NODE_NAMES = new Set([
  'product_search',
  'recommendation',
  'checkout',
  'tracking',
  'gift',
  'general_response',
  'fallback',
]);

// ─── Orchestrator ─────────────────────────────────────────────────────────────

@Injectable()
export class AgentOrchestrator {
  // How many prior messages ride along on every Gemini call this turn.
  private static readonly HISTORY_WINDOW = 8;

  private readonly logger = new Logger(AgentOrchestrator.name);
  private readonly graph: ReturnType<AgentOrchestrator['buildGraph']>;

  constructor(
    private readonly mcpClient: McpClientService,
    private readonly gemini: GeminiService,
    private readonly prompts: PromptLibrary,
    private readonly intentClassifier: IntentClassifier,
    private readonly searchNode: ProductSearchNode,
    private readonly recommendNode: RecommendationNode,
    private readonly checkoutNode: CheckoutNode,
    private readonly trackingNode: TrackingNode,
    private readonly giftNode: GiftNode,
  ) {
    this.graph = this.buildGraph();
  }

  private buildGraph() {
    const graph = new StateGraph(AgentStateAnnotation)
      // ── Nodes ──────────────────────────────────────────────
      .addNode(
        'intent_classifier',
        this.intentClassifier.invoke.bind(this.intentClassifier),
      )
      .addNode('product_search', this.searchNode.invoke.bind(this.searchNode))
      .addNode(
        'recommendation',
        this.recommendNode.invoke.bind(this.recommendNode),
      )
      .addNode('checkout', this.checkoutNode.invoke.bind(this.checkoutNode))
      .addNode('tracking', this.trackingNode.invoke.bind(this.trackingNode))
      .addNode('gift', this.giftNode.invoke.bind(this.giftNode))
      .addNode('general_response', this.handleGeneralResponse.bind(this))
      .addNode('fallback', this.handleFallback.bind(this))

      // ── Edges ──────────────────────────────────────────────
      .addEdge(START, 'intent_classifier')

      // Conditional routing based on classified intent
      .addConditionalEdges('intent_classifier', this.routeByIntent.bind(this), {
        product_search: 'product_search',
        recommendation: 'recommendation',
        checkout: 'checkout',
        tracking: 'tracking',
        gift: 'gift',
        general_response: 'general_response',
        fallback: 'fallback',
      })

      // All agent nodes converge to END
      .addEdge('product_search', END)
      .addEdge('recommendation', END)
      .addEdge('checkout', END)
      .addEdge('tracking', END)
      .addEdge('gift', END)
      .addEdge('general_response', END)
      .addEdge('fallback', END);

    return graph;
  }

  /**
   * Streams agent response tokens back to the controller.
   * Uses async generator pattern for backpressure-safe streaming.
   */
  async *streamMessage(params: {
    chatId: string;
    message: string;
    language: Language;
    history: Array<{ role: PrismaMessageRole; content: string }>;
    /**
     * Validated context from the previous turn (Redis cache or
     * `chats.context_state`). Callers must run untrusted storage payloads
     * through `parsePersistedAgentState()` — the orchestrator trusts this.
     */
    contextState: PersistedAgentState | null;
    userId?: string;
    /**
     * Result of `IntentClassifier.classify()`, run by the caller *concurrently*
     * with language detection instead of strictly after it — seeding it here
     * lets `intent_classifier` (the graph's first node) skip its own
     * generateContent() call entirely (see its `state.intent !== undefined`
     * check), turning two sequential Gemini round trips into one.
     */
    precomputedIntent?: Partial<AgentState>;
    /**
     * A fresh snapshot of the shopper's cart, sent by the frontend with this
     * turn's request (see SendMessageDto.cartItems). The cart itself lives in
     * the browser (Zustand/localStorage) — the backend has no server-side
     * cart to read — so checkout.node.ts only ever sees what's here. Falls
     * back to the last-persisted snapshot when the caller doesn't send one
     * (e.g. a non-cart-aware caller), rather than wiping cartItems to empty.
     */
    cartItemsOverride?: CartItem[];
  }): AsyncGenerator<StreamChunk> {
    const initialMessages: BaseMessage[] = [
      new SystemMessage(this.prompts.getSystemPrompt(params.language)),
      // Convert DB history to LangChain messages. Kept short deliberately —
      // this whole array (minus the system message) gets sent as `contents`
      // on every generateText() call for the turn (see
      // handleGeneralResponse's toGeminiMessages(state.messages)), so it's
      // paid for in tokens on every single message, not just once. A
      // shopping assistant's turns are typically short and self-contained;
      // HISTORY_WINDOW trades a bit of long-conversation recall for a
      // meaningfully smaller per-request token bill under a quota-limited
      // free tier.
      ...params.history
        .slice(-AgentOrchestrator.HISTORY_WINDOW)
        .map((m) =>
          m.role === PrismaMessageRole.USER
            ? new HumanMessage(m.content)
            : new ToolMessage({ content: m.content, tool_call_id: 'history' }),
        ),
      new HumanMessage(params.message),
    ];

    const initialState: Partial<AgentState> = {
      chatId: params.chatId,
      userId: params.userId,
      language: params.language,
      messages: initialMessages,
      retryCount: 0,
      // Restore persisted state for cart/context continuity.
      // Assigning PersistedAgentState fields into Partial<AgentState> here is
      // what makes the two schemas provably compatible at compile time.
      cartItems:
        params.cartItemsOverride ?? params.contextState?.cartItems ?? [],
      // 'placed' is a terminal step — a previously placed order's address/
      // date/gift-message must never leak into a *new* checkout for a
      // different cart later in the same chat, so a fresh checkout starts
      // from a clean slate instead of silently reusing stale details.
      ...(params.contextState?.checkoutStep !== 'placed' && {
        shippingAddress: params.contextState?.shippingAddress,
        giftMessage: params.contextState?.giftMessage,
        deliveryDate: params.contextState?.deliveryDate,
        checkoutStep: params.contextState?.checkoutStep,
      }),
      orderRef: params.contextState?.orderRef,
      // A prior turn's search context, so "show cheaper ones" or "another
      // one" has something to refer back to — ProductSearchNode falls back
      // to this when the current turn's classification didn't extract a new
      // product query (see its `state.searchQuery` handling).
      searchQuery: params.contextState?.searchQuery,
      budget: params.contextState?.budget,
      // Seeds intent_classifier's short-circuit — see precomputedIntent's
      // doc comment above and the node's `state.intent !== undefined` check.
      ...params.precomputedIntent,
    };

    const compiledGraph = this.graph.compile();

    // LangGraph streaming — yields events for each node execution
    const streamEvents = compiledGraph.streamEvents(initialState, {
      version: 'v2',
    });

    let finalState: Partial<AgentState> = {};
    let streamedContent = '';

    for await (const event of streamEvents) {
      const graphEvent = event as GraphStreamEvent;
      switch (graphEvent.event) {
        case 'on_chat_model_stream':
          // Stream LLM token deltas
          if (typeof graphEvent.data?.chunk?.content === 'string') {
            streamedContent += graphEvent.data.chunk.content;
            yield {
              type: 'text_delta',
              content: graphEvent.data.chunk.content,
            };
          }
          break;

        case 'on_tool_start':
          yield {
            type: 'tool_call',
            toolCall: { name: graphEvent.name, input: graphEvent.data?.input },
          };
          break;

        case 'on_tool_end':
          yield {
            type: 'tool_result',
            result: graphEvent.data?.output,
          };
          break;

        case 'on_chain_end':
          // The compiled graph's own on_chain_end fires with name "LangGraph"
          // (its internal wrapper name) or "__start__" for the entry node —
          // never the literal "__end__" this used to check for, so
          // finalState was never populated and no response ever reached the
          // client, independent of whether the Gemini call underneath
          // succeeded. Matching on the actual terminal node names (the ones
          // this graph itself defines, wired to END in buildGraph()) instead
          // of a library-internal event name is what makes this work
          // regardless of how the graph wrapper happens to be named.
          if (
            TERMINAL_NODE_NAMES.has(graphEvent.name ?? '') &&
            isPartialAgentState(graphEvent.data?.output)
          ) {
            finalState = { ...finalState, ...graphEvent.data.output };
          }
          break;
      }
    }

    if (!streamedContent && finalState.response) {
      yield {
        type: 'text_delta',
        content: finalState.response,
      };
    }

    // `on_tool_start`/`on_tool_end` (handled above) never actually fire in
    // this graph — they're LangChain's tracing for genuine bound-tool
    // invocations, and our nodes call the MCP client as a plain async
    // function inside a custom node, invisible to that tracing. Without this,
    // search/recommendation results captured in finalState never reached the
    // client at all — the frontend's product cards had no data to render.
    // Reusing the same 'tool_result' chunk shape here (rather than inventing
    // a new one) means the existing frontend handling needs no changes.
    if (finalState.searchResults && finalState.searchResults.length > 0) {
      yield {
        type: 'tool_result',
        result: { products: finalState.searchResults },
      };
    }

    // checkoutUrl is never seeded from contextState (see initialState above)
    // and no other node ever sets it — so it's only truthy here on the exact
    // turn checkout.node.ts just called kapruka_create_order successfully,
    // never on a later turn just because an order was placed earlier in this
    // chat.
    if (
      finalState.checkoutUrl &&
      finalState.orderRef &&
      finalState.orderSummary
    ) {
      yield {
        type: 'checkout_ready',
        orderRef: finalState.orderRef,
        checkoutUrl: finalState.checkoutUrl,
        summary: finalState.orderSummary,
      };
    }

    // Yield final state update for Redis persistence.
    // Narrowing AgentState → PersistedAgentState here is the compile-time proof
    // that the persisted schema stays in sync with the live graph state.
    const persisted: PersistedAgentState = {
      cartItems: finalState.cartItems,
      shippingAddress: finalState.shippingAddress,
      // Checkout context — without persisting these, every turn after the
      // first checkout message forgot everything already collected (and
      // chat.service.ts's checkout-stickiness override has nothing to key
      // off), forcing the shopper to repeat their address each message.
      giftMessage: finalState.giftMessage,
      deliveryDate: finalState.deliveryDate,
      checkoutStep: finalState.checkoutStep,
      orderRef: finalState.orderRef,
      checkoutUrl: finalState.checkoutUrl,
      orderSummary: finalState.orderSummary,
      language: finalState.language,
      // Carries the last product query across turns so a purely referential
      // follow-up ("show cheaper ones", "another one") has something to
      // resolve against — see ProductSearchNode, which falls back to this
      // when the current turn's classification didn't extract a new query.
      searchQuery: finalState.searchQuery,
      budget: finalState.budget,
    };

    yield { type: 'state_update', state: persisted };
  }

  // ─── Router ───────────────────────────────────────────────────

  private routeByIntent(
    state: AgentState,
  ): keyof ReturnType<AgentOrchestrator['buildConditionalMap']> {
    const intent = state.intent;
    const confidence = state.intentConfidence ?? 0;

    // Low confidence → fallback for clarification
    if (confidence < 0.6) return 'fallback';

    const routeMap: Record<
      Intent,
      keyof ReturnType<AgentOrchestrator['buildConditionalMap']>
    > = {
      SEARCH: 'product_search',
      RECOMMEND: 'recommendation',
      CHECKOUT: 'checkout',
      ADD_TO_CART: 'checkout',
      REMOVE_FROM_CART: 'checkout',
      TRACK: 'tracking',
      GIFT: 'gift',
      LANGUAGE_SWITCH: 'general_response',
      CHITCHAT: 'general_response',
    };

    return routeMap[intent ?? 'CHITCHAT'] ?? 'general_response';
  }

  private buildConditionalMap() {
    return {
      product_search: 'product_search',
      recommendation: 'recommendation',
      checkout: 'checkout',
      tracking: 'tracking',
      gift: 'gift',
      general_response: 'general_response',
      fallback: 'fallback',
    } as const;
  }

  // ─── Leaf nodes ───────────────────────────────────────────────

  private async handleGeneralResponse(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    const response = await this.gemini.generateText({
      systemInstruction: this.prompts.getSystemPrompt(state.language),
      messages: this.toGeminiMessages(state.messages),
      temperature: 0.7,
      maxOutputTokens: 700,
    });

    return {
      response,
      responseType: 'text',
    };
  }

  private toGeminiMessages(messages: BaseMessage[]): GeminiMessage[] {
    return messages
      .filter((message) => message._getType() !== 'system')
      .map((message) => ({
        role:
          message._getType() === 'ai' ? ('model' as const) : ('user' as const),
        text: this.messageContentToText(message.content),
      }))
      .filter((message) => message.text.trim().length > 0);
  }

  private messageContentToText(content: BaseMessage['content']): string {
    if (typeof content === 'string') return content;

    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if ('text' in part && typeof part.text === 'string') return part.text;
        return JSON.stringify(part);
      })
      .join('\n');
  }

  private handleFallback(state: AgentState): Promise<Partial<AgentState>> {
    const clarifications: Record<Language, string> = {
      EN: "I'm not sure what you're looking for. Could you tell me more? For example: 'Find birthday cake', 'Send flowers to Colombo', or 'Track my order KP12345'.",
      SI: 'ඔබ සොයන දේ මට හරියටම නොතේරෙයි. කරුණාකර වැඩිදුර පැහැදිලි කරන්න.',
      SINGLISH:
        "Machan, I didn't catch that. Can you say again? Like 'find cake' or 'track order'?",
    };

    return Promise.resolve({
      response: clarifications[state.language] ?? clarifications.EN,
      responseType: 'text',
    });
  }
}

/**
 * Guard for LangGraph's loosely-typed `on_chain_end` payload.
 *
 * The value originates from our own compiled graph, so its *shape* is trusted;
 * this only rules out the non-object payloads LangGraph is free to emit
 * (arrays, primitives) before we treat it as graph state.
 */
function isPartialAgentState(value: unknown): value is Partial<AgentState> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
