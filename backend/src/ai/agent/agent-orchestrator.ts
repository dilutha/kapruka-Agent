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
 *   intent_classifier  ← GPT-4o with structured output
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
import { ConfigService } from '@nestjs/config';
import {
  Annotation,
  StateGraph,
  START,
  END,
} from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ToolMessage } from '@langchain/core/messages';

import { McpClientService } from '../../mcp/mcp-client.service';
import { PromptLibrary } from './prompts/prompt-library';
import { IntentClassifier } from './nodes/intent-classifier.node';
import { ProductSearchNode } from './nodes/product-search.node';
import { RecommendationNode } from './nodes/recommendation.node';
import { CheckoutNode } from './nodes/checkout.node';
import { TrackingNode } from './nodes/tracking.node';
import { GiftNode } from './nodes/gift.node';
import { Language, MessageRole as PrismaMessageRole } from '@prisma/client';

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

  // Cart context (mirrors Kapruka cart state)
  cartItems: Annotation<CartItem[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // Checkout context
  shippingAddress: Annotation<Address | undefined>(),
  giftMessage: Annotation<GiftMessageInput | undefined>(),
  deliverySlot: Annotation<DeliverySlot | undefined>(),

  // Order context (for tracking)
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

export type ResponseType = 'text' | 'product_list' | 'cart' | 'order_status' | 'checkout';

export interface KaprukProduct {
  id: string;
  name: string;
  category: string;
  priceMin: number;
  priceMax?: number;
  currency: string;
  isAvailable: boolean;
  imageUrls: string[];
}

interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface Address {
  recipientName: string;
  phone: string;
  addressLine1: string;
  city: string;
  district: string;
  postalCode?: string;
}

interface GiftMessageInput {
  fromName: string;
  toName: string;
  message: string;
  isAnonymous?: boolean;
}

interface DeliverySlot {
  slotId: string;
  date: string;
  label: string;
}

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
  | { type: 'state_update'; state: Partial<AgentState> }
  | { type: 'error'; code: string; message: string };

// ─── Orchestrator ─────────────────────────────────────────────────────────────

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);
  private readonly graph: ReturnType<AgentOrchestrator['buildGraph']>;

  constructor(
    private readonly config: ConfigService,
    private readonly mcpClient: McpClientService,
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
      .addNode('intent_classifier', this.intentClassifier.invoke.bind(this.intentClassifier))
      .addNode('product_search', this.searchNode.invoke.bind(this.searchNode))
      .addNode('recommendation', this.recommendNode.invoke.bind(this.recommendNode))
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
    contextState: Partial<AgentState> | null;
    userId?: string;
  }): AsyncGenerator<StreamChunk> {
    const initialMessages: BaseMessage[] = [
      new SystemMessage(this.prompts.getSystemPrompt(params.language)),
      // Convert DB history to LangChain messages
      ...params.history.slice(-20).map((m) =>
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
      // Restore persisted state for cart/context continuity
      cartItems: params.contextState?.cartItems ?? [],
      shippingAddress: params.contextState?.shippingAddress,
    };

    const compiledGraph = this.graph.compile();

    // LangGraph streaming — yields events for each node execution
    const streamEvents = await compiledGraph.streamEvents(initialState, {
      version: 'v2',
    });

    let finalState: Partial<AgentState> = {};

    for await (const event of streamEvents) {
      switch (event.event) {
        case 'on_chat_model_stream':
          // Stream LLM token deltas
          if (event.data.chunk?.content) {
            yield {
              type: 'text_delta',
              content: event.data.chunk.content as string,
            };
          }
          break;

        case 'on_tool_start':
          yield {
            type: 'tool_call',
            toolCall: { name: event.name, input: event.data.input },
          };
          break;

        case 'on_tool_end':
          yield {
            type: 'tool_result',
            result: event.data.output,
          };
          break;

        case 'on_chain_end':
          if (event.name === '__end__') {
            finalState = event.data.output as Partial<AgentState>;
          }
          break;
      }
    }

    // Yield final state update for Redis persistence
    yield {
      type: 'state_update',
      state: {
        cartItems: finalState.cartItems,
        shippingAddress: finalState.shippingAddress,
        language: finalState.language,
      },
    };
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
    const model = new ChatOpenAI({
      model: 'gpt-4o',
      temperature: 0.7,
      streaming: true,
    });

    const response = await model.invoke(state.messages);

    return {
      response: response.content as string,
      responseType: 'text',
    };
  }

  private async handleFallback(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    const clarifications: Record<Language, string> = {
      EN: "I'm not sure what you're looking for. Could you tell me more? For example: 'Find birthday cake', 'Send flowers to Colombo', or 'Track my order KP12345'.",
      SI: "ඔබ සොයන දේ මට හරියටම නොතේරෙයි. කරුණාකර වැඩිදුර පැහැදිලි කරන්න.",
      SINGLISH: "Machan, I didn't catch that. Can you say again? Like 'find cake' or 'track order'?",
    };

    return {
      response: clarifications[state.language] ?? clarifications.EN,
      responseType: 'text',
    };
  }
}
