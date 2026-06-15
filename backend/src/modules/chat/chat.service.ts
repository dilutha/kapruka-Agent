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
import { AgentOrchestrator } from '../../ai/agent/agent-orchestrator';
import { LanguageDetector } from '../../ai/language/language-detector';
import { RedisService } from '../../redis/redis.service';
import { AnalyticsService } from '../analytics/analytics.service';

import { CreateChatDto } from './dto/create-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { Language, MessageRole } from '@prisma/client';

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

  async listChats(params: ChatOwnerContext): Promise<ChatResponseDto[]> {
    const chats = await this.chatRepo.findByOwner(params);
    return chats.map(ChatResponseDto.fromEntity);
  }

  async getChat(params: GetChatParams): Promise<ChatResponseDto> {
    const { chatId, userId, guestUserId } = params;
    const chat = await this.chatRepo.findByIdWithMessages(chatId);

    if (!chat) throw new NotFoundException(`Chat ${chatId} not found`);
    this.assertOwnership(chat, userId, guestUserId);

    return ChatResponseDto.fromEntity(chat);
  }

  async archiveChat(params: GetChatParams): Promise<void> {
    const { chatId, userId, guestUserId } = params;
    const chat = await this.chatRepo.findById(chatId);

    if (!chat) throw new NotFoundException(`Chat ${chatId} not found`);
    this.assertOwnership(chat, userId, guestUserId);

    await this.chatRepo.archive(chatId);
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

    // Step 1: Detect language
    const detectedLanguage = await this.languageDetector.detect(dto.content);
    if (detectedLanguage !== chat.detectedLanguage) {
      await this.chatRepo.updateLanguage(chatId, detectedLanguage);
    }

    // Step 2: Persist user message
    const userMessage = await this.messageRepo.create({
      chatId,
      role: MessageRole.USER,
      content: dto.content,
      metadata: { detectedLanguage },
    });

    this.sendSseEvent(res, 'message_start', { messageId: userMessage.id });

    // Step 3: Restore agent state from Redis (for conversation continuity)
    const cachedState = await this.redis.get(`agent:state:${chatId}`);
    const agentState = cachedState ? JSON.parse(cachedState) : null;

    // Step 4: Stream agent response
    let fullContent = '';
    let toolCallsAccumulator: unknown[] = [];

    try {
      const stream = this.agent.streamMessage({
        chatId,
        message: dto.content,
        language: detectedLanguage,
        history: chat.messages ?? [],
        contextState: agentState ?? chat.contextState,
        userId,
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
        toolCalls: toolCallsAccumulator.length > 0 ? toolCallsAccumulator : undefined,
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
      this.sendSseEvent(res, 'error', {
        code: 'AGENT_ERROR',
        message: 'The assistant encountered an error. Please try again.',
      });
    } finally {
      res.end();
    }
  }

  // ─── Private helpers ─────────────────────────────────────────

  private sendSseEvent(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
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
