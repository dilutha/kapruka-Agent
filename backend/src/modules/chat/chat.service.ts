/**
 * Chat Service
 *
 * Application-layer service orchestrating:
 *  1. Chat session lifecycle management
 *  2. Message persistence
 *  3. AI agent invocation with streaming
 *  4. Language detection and normalization
 *  5. Context window management
 *
 * This layer contains no infrastructure concerns — it depends
 * on repository abstractions and agent interfaces.
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';

import { ChatRepository } from './repositories/chat.repository';
import { MessageRepository } from './repositories/message.repository';
import {
  AgentOrchestrator,
  AgentState,
} from '../../ai/agent/agent-orchestrator';
import { IntentClassifier } from '../../ai/agent/nodes/intent-classifier.node';
import { GeminiQuotaExceededException } from '../../ai/gemini/gemini.service';
import {
  parsePersistedAgentState,
  type PersistedAgentState,
} from '../../ai/agent/state/agent-state.schema';
import { LanguageDetector } from '../../ai/language/language-detector';
import { RedisService } from '../../redis/redis.service';
import { AnalyticsService } from '../analytics/analytics.service';

import { CreateChatDto } from './dto/create-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateChatDto } from './dto/update-chat.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { ChatStatus, Language, MessageRole, Prisma } from '@prisma/client';

interface ChatOwnerContext {
  userId?: string;
  guestUserId?: string;
}

interface CreateChatParams extends ChatOwnerContext {
  dto: CreateChatDto;
}

interface GetChatParams extends ChatOwnerContext {
  chatId: string;
}

interface RenameChatParams extends GetChatParams {
  dto: UpdateChatDto;
}

interface SendMessageParams extends ChatOwnerContext {
  chatId: string;
  dto: SendMessageDto;
  res: Response;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly chatRepo: ChatRepository,
    private readonly messageRepo: MessageRepository,
    private readonly agent: AgentOrchestrator,
    private readonly languageDetector: LanguageDetector,
    private readonly intentClassifier: IntentClassifier,
    private readonly redis: RedisService,
    private readonly analytics: AnalyticsService,
  ) {}

  async createChat(params: CreateChatParams): Promise<ChatResponseDto> {
    const { dto, userId, guestUserId } = params;

    const chat = await this.chatRepo.create({
      userId: userId ?? null,
      guestUserId: guestUserId ?? null,
      title: dto.title ?? null,
      detectedLanguage: Language.EN,
    });

    this.logger.log(`Chat created: ${chat.id} for ${userId ?? guestUserId}`);
    return ChatResponseDto.fromEntity(chat);
  }

  async listChats(
    params: ChatOwnerContext & { archived?: boolean },
  ): Promise<ChatResponseDto[]> {
    const chats = await this.chatRepo.findByOwner({
      userId: params.userId,
      guestUserId: params.guestUserId,
      status: params.archived ? ChatStatus.ARCHIVED : ChatStatus.ACTIVE,
    });
    return chats.map((chat) => ChatResponseDto.fromEntity(chat));
  }

  async getChat(params: GetChatParams): Promise<ChatResponseDto> {
    const { chatId, userId, guestUserId } = params;
    const chat = await this.chatRepo.findByIdWithMessages(chatId);

    // Deleted chats are treated as gone, not just hidden from the list —
    // otherwise a bookmarked/history URL would still open a chat the user
    // just deleted. Archived chats ARE still reachable directly (that's the
    // whole point of archive vs. delete — recoverable, just decluttered).
    if (!chat || chat.status === ChatStatus.DELETED) {
      throw new NotFoundException(`Chat ${chatId} not found`);
    }
    this.assertOwnership(chat, userId, guestUserId);

    return ChatResponseDto.fromEntity(chat);
  }

  async renameChat(params: RenameChatParams): Promise<ChatResponseDto> {
    const { chatId, userId, guestUserId, dto } = params;
    const chat = await this.findActiveOrArchived(chatId, userId, guestUserId);

    const updated = await this.chatRepo.updateTitle(chatId, dto.title);
    return ChatResponseDto.fromEntity(updated ?? chat);
  }

  async setPinned(
    params: GetChatParams & { isPinned: boolean },
  ): Promise<ChatResponseDto> {
    const { chatId, userId, guestUserId, isPinned } = params;
    await this.findActiveOrArchived(chatId, userId, guestUserId);

    const updated = await this.chatRepo.setPinned(chatId, isPinned);
    return ChatResponseDto.fromEntity(updated);
  }

  async archiveChat(params: GetChatParams): Promise<ChatResponseDto> {
    const { chatId, userId, guestUserId } = params;
    await this.findActiveOrArchived(chatId, userId, guestUserId);

    const updated = await this.chatRepo.setStatus(chatId, ChatStatus.ARCHIVED);
    return ChatResponseDto.fromEntity(updated);
  }

  async unarchiveChat(params: GetChatParams): Promise<ChatResponseDto> {
    const { chatId, userId, guestUserId } = params;
    await this.findActiveOrArchived(chatId, userId, guestUserId);

    const updated = await this.chatRepo.setStatus(chatId, ChatStatus.ACTIVE);
    return ChatResponseDto.fromEntity(updated);
  }

  /** Soft-delete — distinct from archive. Not recoverable via the UI. */
  async deleteChat(params: GetChatParams): Promise<void> {
    const { chatId, userId, guestUserId } = params;
    await this.findActiveOrArchived(chatId, userId, guestUserId);

    await this.chatRepo.setStatus(chatId, ChatStatus.DELETED);
  }

  async duplicateChat(params: GetChatParams): Promise<ChatResponseDto> {
    const { chatId, userId, guestUserId } = params;
    const source = await this.findActiveOrArchived(chatId, userId, guestUserId);

    const messages = await this.messageRepo.findByChatId(chatId);
    const copy = await this.chatRepo.duplicate(source);
    await this.messageRepo.copyToChat(messages, copy.id);

    this.logger.log(`Chat ${chatId} duplicated as ${copy.id}`);
    return ChatResponseDto.fromEntity({ ...copy, messages });
  }

  private async findActiveOrArchived(
    chatId: string,
    userId: string | undefined,
    guestUserId: string | undefined,
  ) {
    const chat = await this.chatRepo.findById(chatId);
    if (!chat || chat.status === ChatStatus.DELETED) {
      throw new NotFoundException(`Chat ${chatId} not found`);
    }
    this.assertOwnership(chat, userId, guestUserId);
    return chat;
  }

  /**
   * Core streaming pipeline:
   *  1. Detect language of incoming message
   *  2. Persist user message
   *  3. Build agent state from chat history + context
   *  4. Stream agent response tokens to SSE connection
   *  5. Persist finalized assistant message
   *  6. Update chat context state for resumption
   *  7. Fire analytics event
   */
  async sendMessageStream(params: SendMessageParams): Promise<void> {
    const { chatId, dto, userId, guestUserId, res } = params;

    const chat = await this.chatRepo.findByIdWithMessages(chatId);
    if (!chat) throw new NotFoundException(`Chat ${chatId} not found`);
    this.assertOwnership(chat, userId, guestUserId);

    // Step 1: Detect language AND classify intent concurrently. Neither
    // depends on the other's result — classification is a pure function of
    // the message text, and language is only needed later to seed the
    // system prompt — but they used to run strictly sequentially (detect,
    // *then* start the graph, whose first node classifies), paying for two
    // full Gemini round trips back-to-back on every single message. Running
    // them together removes one of those two round trips from the critical
    // path entirely; the graph's own intent_classifier node then sees
    // `state.intent` already set and skips its call (see that node).
    const pipelineStartedAt = Date.now();
    const [detectedLanguage, precomputedIntent] = await Promise.all([
      this.languageDetector.detect(dto.content),
      this.classifyIntentSafely(dto.content),
    ]);
    this.logger.debug(
      `Language+intent (parallel) took ${Date.now() - pipelineStartedAt}ms`,
    );

    if (detectedLanguage !== chat.detectedLanguage) {
      await this.chatRepo.updateLanguage(chatId, detectedLanguage);
    }

    // Step 2: Persist user message, and restore agent state from Redis (hot,
    // 10-min TTL) concurrently — one writes to Postgres, the other reads
    // Redis, neither depends on the other.
    const [userMessage, cachedState] = await Promise.all([
      this.messageRepo.create({
        chatId,
        role: MessageRole.USER,
        content: dto.content,
        metadata: { detectedLanguage },
      }),
      this.redis.get(`agent:state:${chatId}`),
    ]);

    this.sendSseEvent(res, 'message_start', { messageId: userMessage.id });

    // Both sources are untrusted JSON until validated.
    const contextState = this.restoreContextState(
      chatId,
      cachedState,
      chat.contextState,
    );

    // Checkout-context stickiness: once the conversational checkout flow has
    // started (and hasn't finished — 'placed' is terminal, not "still
    // active"), every message belongs to it. An address, phone number, or
    // delivery date typed mid-flow must never be misclassified as chitchat
    // or a new search just because it doesn't superficially look like a
    // checkout message. Overriding here (rather than only rendering fields
    // in checkout.node.ts) is what makes that true even for a plain "yes" or
    // a phone number that reads as pure noise to a generic intent
    // classifier.
    const effectiveIntent =
      contextState?.checkoutStep && contextState.checkoutStep !== 'placed'
        ? { intent: 'CHECKOUT' as const, intentConfidence: 1 }
        : precomputedIntent;

    // Step 4: Stream agent response
    let fullContent = '';
    const toolCallsAccumulator: unknown[] = [];

    try {
      const stream = this.agent.streamMessage({
        chatId,
        message: dto.content,
        language: detectedLanguage,
        history: chat.messages ?? [],
        contextState,
        userId,
        precomputedIntent: effectiveIntent,
        cartItemsOverride: dto.cartItems?.map((item) => ({
          productId: item.kaprukaProdId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });

      for await (const chunk of stream) {
        switch (chunk.type) {
          case 'text_delta':
            fullContent += chunk.content;
            this.sendSseEvent(res, 'text_delta', { content: chunk.content });
            break;

          case 'tool_call':
            toolCallsAccumulator.push(chunk.toolCall);
            this.sendSseEvent(res, 'tool_call', { toolCall: chunk.toolCall });
            break;

          case 'tool_result':
            this.sendSseEvent(res, 'tool_result', { result: chunk.result });
            break;

          case 'checkout_ready':
            this.sendSseEvent(res, 'checkout_ready', {
              orderRef: chunk.orderRef,
              checkoutUrl: chunk.checkoutUrl,
              summary: chunk.summary,
            });
            break;

          case 'state_update':
            // Persist updated agent state to Redis (10-minute TTL)
            await this.redis.setEx(
              `agent:state:${chatId}`,
              600,
              JSON.stringify(chunk.state),
            );
            break;

          case 'error':
            this.sendSseEvent(res, 'error', {
              code: chunk.code,
              message: chunk.message,
            });
            break;
        }
      }

      // Step 5: Persist finalized assistant message
      const assistantMessage = await this.messageRepo.create({
        chatId,
        role: MessageRole.ASSISTANT,
        content: fullContent,
        toolCalls:
          toolCallsAccumulator.length > 0 ? toolCallsAccumulator : undefined,
        metadata: { language: detectedLanguage },
      });

      this.sendSseEvent(res, 'done', { messageId: assistantMessage.id });

      // Step 7: Analytics
      await this.analytics.track({
        eventName: 'chat_message_sent',
        userId,
        properties: {
          chatId,
          language: detectedLanguage,
          hasToolCalls: toolCallsAccumulator.length > 0,
        },
      });
    } catch (error) {
      this.logger.error(`Agent stream error for chat ${chatId}:`, error);

      // GeminiQuotaExceededException's message is already a safe, specific,
      // user-facing string ("try again in N seconds") — forwarding it is
      // exactly what lets the frontend show that instead of a generic
      // failure. Everything else collapses to the generic message: an
      // unexpected exception's raw text (a DB error, an internal auth/config
      // message like "check GEMINI_API_KEY") is never appropriate to show
      // an end user.
      const isQuotaError = error instanceof GeminiQuotaExceededException;
      this.sendSseEvent(res, 'error', {
        code: isQuotaError ? 'QUOTA_EXCEEDED' : 'AGENT_ERROR',
        message: isQuotaError
          ? error.message
          : 'The assistant encountered an error. Please try again.',
      });
    } finally {
      res.end();
    }
  }

  // ─── Private helpers ─────────────────────────────────────────

  /**
   * Runs `IntentClassifier.classify()` ahead of the graph, alongside
   * language detection (see the Promise.all above). Mirrors the exact
   * error-handling `IntentClassifier.invoke()` itself uses — a quota
   * exhaustion propagates (the whole assistant can't call the model right
   * now, not just this classification), anything else degrades to a
   * low-confidence CHITCHAT rather than failing the entire turn over a
   * classification hiccup.
   */
  private async classifyIntentSafely(
    text: string,
  ): Promise<Partial<AgentState>> {
    try {
      return await this.intentClassifier.classify(text);
    } catch (error) {
      if (error instanceof GeminiQuotaExceededException) throw error;

      this.logger.error('Pre-computed intent classification failed:', error);
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

  private sendSseEvent(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * Rebuilds the agent's context for this turn from the two places it can live.
   *
   * Both sources are untrusted at the type level — Redis hands back a raw
   * string, Prisma hands back `JsonValue` — so each is validated against
   * `persistedAgentStateSchema`. Anything malformed (a stale shape from a
   * previous deploy, a truncated cache write, hand-edited JSON) is dropped and
   * logged rather than smuggled into the graph as an `AgentState`.
   */
  private restoreContextState(
    chatId: string,
    cached: string | null,
    persisted: Prisma.JsonValue | null,
  ): PersistedAgentState | null {
    const fromCache = parsePersistedAgentState(cached);
    if (fromCache) return fromCache;
    if (cached !== null) {
      this.logger.warn(
        `Discarding unparseable cached agent state for chat ${chatId}`,
      );
    }

    const fromDb = parsePersistedAgentState(persisted);
    if (fromDb) return fromDb;
    if (persisted !== null) {
      this.logger.warn(
        `Discarding invalid contextState on chat ${chatId} — falling back to a fresh context`,
      );
    }

    return null;
  }

  private assertOwnership(
    chat: { userId: string | null; guestUserId: string | null },
    userId?: string,
    guestUserId?: string,
  ): void {
    const isOwner =
      (userId && chat.userId === userId) ||
      (guestUserId && chat.guestUserId === guestUserId);

    if (!isOwner) {
      throw new ForbiddenException('Access denied to this chat');
    }
  }
}
