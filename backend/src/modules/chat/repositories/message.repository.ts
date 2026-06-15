import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MessageRole } from '@prisma/client';

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
        chatId:     data.chatId,
        role:       data.role,
        content:    data.content,
        toolCalls:  data.toolCalls ? (data.toolCalls as any) : undefined,
        toolResult: data.toolResult ? (data.toolResult as any) : undefined,
        metadata:   data.metadata  ? (data.metadata  as any) : undefined,
      },
    });
  }
}
