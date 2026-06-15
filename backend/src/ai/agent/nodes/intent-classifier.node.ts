/**
 * Intent Classifier Node
 *
 * First node in the LangGraph state machine.
 * Classifies user intent using GPT-4o structured output (JSON mode).
 *
 * Design decisions:
 *  - Uses JSON mode for deterministic structured output (no parsing failures)
 *  - Temperature 0 for classification stability
 *  - Separate fast model from response model (gpt-4o-mini for classification,
 *    gpt-4o for generation) to reduce latency and cost
 *  - Extracts entities inline to avoid a second LLM call
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { Runnable } from '@langchain/core/runnables';

import { AgentState, Intent } from '../agent-orchestrator';
import { PromptLibrary } from '../prompts/prompt-library';

// ─── Structured output schema ─────────────────────────────────────────────────

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
      query: z.string().optional(),
      orderId: z.string().optional(),
      occasion: z.string().optional(),
      budget: z.number().optional(),
      language: z.enum(['EN', 'SI', 'SINGLISH']).optional(),
    })
    .optional(),
});

type IntentResult = z.infer<typeof IntentSchema>;

@Injectable()
export class IntentClassifier {
  private readonly logger = new Logger(IntentClassifier.name);
  private readonly model: Runnable<unknown, IntentResult>;

  constructor(
    private readonly config: ConfigService,
    private readonly prompts: PromptLibrary,
  ) {
    // Use mini model for classification — fast and cheap
    this.model = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
    }).withStructuredOutput(IntentSchema);
  }

  async invoke(state: AgentState): Promise<Partial<AgentState>> {
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
        : String(lastUserMessage.content);

    try {
      const result = await this.classifyWithRetry(userText);

      this.logger.debug(
        `Intent: ${result.intent} (${(result.confidence * 100).toFixed(0)}%) — "${userText.slice(0, 60)}"`,
      );

      // Merge extracted entities back into state
      const stateUpdate: Partial<AgentState> = {
        intent: result.intent as Intent,
        intentConfidence: result.confidence,
      };

      if (result.extracted?.query) {
        stateUpdate.searchQuery = result.extracted.query;
      }
      if (result.extracted?.orderId) {
        stateUpdate.orderRef = result.extracted.orderId;
      }

      return stateUpdate;
    } catch (error) {
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

  private async classifyWithRetry(
    text: string,
    attempt = 1,
  ): Promise<IntentResult> {
    try {
      const result = await this.model.invoke([
        new SystemMessage(this.prompts.getIntentClassificationPrompt()),
        new HumanMessage(text),
      ]);
      return result as IntentResult;
    } catch (error) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 200 * attempt));
        return this.classifyWithRetry(text, attempt + 1);
      }
      throw error;
    }
  }
}
