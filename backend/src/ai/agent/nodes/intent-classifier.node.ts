/**
 * Intent Classifier Node
 *
 * First node in the LangGraph state machine.
 * Classifies user intent using Gemini structured JSON output.
 *
 * Design decisions:
 *  - Uses JSON mode for deterministic structured output (no parsing failures)
 *  - Temperature 0 for classification stability
 *  - Extracts entities inline to avoid a second LLM call
 *  - Retries are handled solely inside GeminiService.withRetry(). This node
 *    used to wrap generateJson() in its own 3-attempt retry loop, which sat
 *    on top of withRetry()'s own retries — a transient failure could trigger
 *    up to 3x3 real generateContent() calls for one user message, and a
 *    deterministic failure (e.g. a schema mismatch) burned 3 identical,
 *    guaranteed-to-fail requests instead of 1. One retry authority, one
 *    retry budget.
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { z } from 'zod';

import { AgentState } from '../agent-orchestrator';
import { PromptLibrary } from '../prompts/prompt-library';
import {
  GeminiQuotaExceededException,
  GeminiService,
} from '../../gemini/gemini.service';
import { RedisService } from '../../../redis/redis.service';

// ─── Structured output schema ─────────────────────────────────────────────────

/**
 * `createIntentSchema()` (gemini.service.ts) marks `extracted` and every one
 * of its properties `nullable: true`. Gemini's structured-output mode fills
 * in every schema property on every response — a field that doesn't apply
 * comes back as JSON `null`, not an omitted key. `z.string().optional()`
 * only accepts `undefined`; it rejects `null`, which is exactly what made
 * IntentClassifier fail on any response where an extracted field didn't
 * apply (nearly every non-checkout, non-search message). `.nullable()`
 * accepts the `null` Gemini actually sends; `.optional()` still covers a key
 * being omitted outright. `intent` and `confidence` are untouched — they're
 * required, non-nullable in the schema, and must keep rejecting bad data.
 */
const IntentSchema = z.object({
  intent: z.enum([
    'SEARCH',
    'RECOMMEND',
    'CHECKOUT',
    'ADD_TO_CART',
    'REMOVE_FROM_CART',
    'TRACK',
    'GIFT',
    'LANGUAGE_SWITCH',
    'CHITCHAT',
  ]),
  confidence: z.number().min(0).max(1),
  extracted: z
    .object({
      // Length caps are a real-world sanity check, not an arbitrary
      // restriction: a search query/occasion/order-id this long can only be
      // a model malfunction, not genuine user input. Observed in testing —
      // at temperature 0, this model can occasionally fall into a
      // repetition loop and fill `query` with hundreds of
      // slash-concatenated category names instead of stopping. Rejecting
      // that here (via the schema, so it's an immediate, clean ZodError
      // IntentClassifier already catches and degrades gracefully from) is
      // far better than forwarding it downstream — the real
      // kapruka_search_products tool caps `q` at 200 chars server-side and
      // would just reject it there anyway, but as an opaque MCP error deep
      // in the product-search node instead of a clear, fast, local failure.
      query: z.string().max(200).nullable().optional(),
      orderId: z.string().max(40).nullable().optional(),
      occasion: z.string().max(100).nullable().optional(),
      budget: z.number().nullable().optional(),
      language: z.enum(['EN', 'SI', 'SINGLISH']).nullable().optional(),
    })
    .nullable()
    .optional(),
});

type IntentResult = z.infer<typeof IntentSchema>;

// Classification is deterministic (temperature: 0) and depends only on the
// message text, not on who's asking — "hi", "track my order", "show me
// cakes" recur constantly across different users and sessions. Caching the
// result is a free win under a quota-limited tier: identical phrasing never
// burns a second generateContent() call. 30 minutes balances that against
// the prompt itself changing between deploys (a stale cached shape is still
// caught by the schema-validating `validate` callback passed to
// redis.remember(), so a bad cache entry just gets evicted, not served).
const INTENT_CACHE_TTL_SECONDS = 30 * 60;

@Injectable()
export class IntentClassifier {
  private readonly logger = new Logger(IntentClassifier.name);

  constructor(
    private readonly prompts: PromptLibrary,
    private readonly gemini: GeminiService,
    private readonly redis: RedisService,
  ) {}

  // Greetings/thanks/acknowledgements recur constantly and are never
  // ambiguous with a product intent — routing them through a full
  // generateContent() round trip just to learn "CHITCHAT" again is a whole
  // extra Gemini call (2-5s+) on the most common turn in the conversation.
  // Deliberately narrow (whole-message match only, short length cap) so a
  // real product query that happens to start with "hi" — "hi, need a cake"
  // — never gets misrouted; it simply doesn't match and falls through to
  // the normal classifier.
  private static readonly FAST_CHITCHAT_PATTERN =
    /^(hi+|he+llo+|hey+|ayubowan|ayubowa|kohomada|howdy|yo|sup|thanks?|thank\s*you|ty|ok(ay)?|bye|goodbye|good\s*(morning|afternoon|evening|night))[!.?\s]*(machan|akka|malli|nangi|ayya)?[!.?\s]*$/i;

  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    // chat.service.ts pre-computes intent concurrently with language
    // detection (see ChatService.sendMessageStream) and seeds it into the
    // graph's initial state — when that's already present, classifying
    // again here would be a second, redundant generateContent() call for
    // the exact same message. This check is what makes that pre-computation
    // actually save a round trip rather than just moving it earlier.
    if (state.intent !== undefined) {
      return {};
    }

    // Get the last user message from the state
    const lastUserMessage = [...state.messages]
      .reverse()
      .find((m) => m._getType() === 'human');

    if (!lastUserMessage) {
      this.logger.warn('IntentClassifier: no human message found in state');
      return { intent: 'CHITCHAT', intentConfidence: 0.5 };
    }

    const userText =
      typeof lastUserMessage.content === 'string'
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage.content);

    return this.classify(userText);
  }

  /**
   * Pure function of the message text — deliberately independent of
   * `AgentState` so it can be kicked off by chat.service.ts *before* the
   * graph even starts, concurrently with language detection, instead of
   * strictly after it. `invoke()` above is now a thin adapter for when this
   * runs as the graph's own first node (the fallback path if a caller didn't
   * pre-compute it).
   */
  async classify(userText: string): Promise<Partial<AgentState>> {
    const short = userText.trim();
    if (
      short.length <= 24 &&
      IntentClassifier.FAST_CHITCHAT_PATTERN.test(short)
    ) {
      this.logger.debug(
        `Intent: CHITCHAT (heuristic, no Gemini call) — "${short}"`,
      );
      return { intent: 'CHITCHAT', intentConfidence: 0.97 };
    }

    try {
      const result = await this.classifyCached(userText);

      this.logger.debug(
        `Intent: ${result.intent} (${(result.confidence * 100).toFixed(0)}%) — "${userText.slice(0, 60)}"`,
      );

      // Merge extracted entities back into state
      const stateUpdate: Partial<AgentState> = {
        intent: result.intent,
        intentConfidence: result.confidence,
      };

      if (result.extracted?.query) {
        stateUpdate.searchQuery = result.extracted.query;
      }
      if (result.extracted?.orderId) {
        stateUpdate.orderRef = result.extracted.orderId;
      }
      if (result.extracted?.occasion) {
        stateUpdate.occasion = result.extracted.occasion;
      }
      if (result.extracted?.budget) {
        stateUpdate.budget = result.extracted.budget;
      }

      return stateUpdate;
    } catch (error) {
      if (error instanceof GeminiQuotaExceededException) {
        // Quota exhaustion isn't "this one classification failed" — the
        // whole assistant is unable to call the model right now. Swallowing
        // it into a generic CHITCHAT fallback would show the user an
        // unhelpful clarification prompt instead of the specific, actionable
        // "try again in N seconds" message this exception already carries —
        // let it propagate to chat.service.ts, which forwards it verbatim.
        throw error;
      }

      this.logger.error('IntentClassifier error:', error);
      // Graceful degradation — treat as chitchat with low confidence
      return {
        intent: 'CHITCHAT',
        intentConfidence: 0.3,
        lastError: {
          code: 'CLASSIFICATION_FAILED',
          message: 'Failed to classify intent',
          isRetryable: true,
        },
      };
    }
  }

  private async classifyCached(text: string): Promise<IntentResult> {
    const normalized = text.trim().toLowerCase();
    const cacheKey = `intent:${createHash('sha256').update(normalized).digest('hex')}`;

    return this.redis.remember(
      cacheKey,
      INTENT_CACHE_TTL_SECONDS,
      () =>
        this.gemini.generateJson<IntentResult>({
          systemInstruction: this.prompts.getIntentClassificationPrompt(),
          prompt: text,
          schema: this.gemini.createIntentSchema(),
          validator: IntentSchema,
          temperature: 0,
          maxOutputTokens: 300,
        }),
      (cached) => {
        const parsed = IntentSchema.safeParse(cached);
        return parsed.success ? parsed.data : null;
      },
    );
  }
}
