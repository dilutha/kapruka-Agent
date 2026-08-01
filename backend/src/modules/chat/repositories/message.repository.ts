import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Message, MessageRole } from '@prisma/client';
import { toInputJson } from '../../../common/utils/json.util';

@Injectable()
export class MessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    chatId: string;
    role: MessageRole;
    content: string;
    toolCalls?: unknown[];
    toolResult?: unknown;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.message.create({
      data: {
        chatId: data.chatId,
        role: data.role,
        content: data.content,
        // `undefined` tells Prisma to omit the column entirely; anything else
        // is normalised into a genuinely JSON-safe value rather than cast.
        toolCalls: data.toolCalls ? toInputJson(data.toolCalls) : undefined,
        toolResult:
          data.toolResult !== undefined
            ? toInputJson(data.toolResult)
            : undefined,
        metadata: data.metadata ? toInputJson(data.metadata) : undefined,
      },
    });
  }

  async findByChatId(chatId: string): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Bulk-copies messages onto a different chat (used by chat duplication). */
  async copyToChat(messages: Message[], targetChatId: string): Promise<void> {
    if (messages.length === 0) return;

    await this.prisma.message.createMany({
      data: messages.map((m) => ({
        chatId: targetChatId,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls ?? undefined,
        toolResult: m.toolResult ?? undefined,
        metadata: m.metadata ?? undefined,
        createdAt: m.createdAt,
      })),
    });
  }
}
