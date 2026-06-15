import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Chat, ChatStatus, Language } from '@prisma/client';

@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string | null;
    guestUserId: string | null;
    title: string | null;
    detectedLanguage: Language;
  }): Promise<Chat> {
    return this.prisma.chat.create({ data });
  }

  async findById(id: string) {
    return this.prisma.chat.findUnique({ where: { id } });
  }

  async findByIdWithMessages(id: string) {
    return this.prisma.chat.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
    });
  }

  async findByOwner(params: { userId?: string; guestUserId?: string }) {
    return this.prisma.chat.findMany({
      where: {
        OR: [
          { userId: params.userId ?? undefined },
          { guestUserId: params.guestUserId ?? undefined },
        ],
        status: ChatStatus.ACTIVE,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async archive(id: string) {
    return this.prisma.chat.update({
      where: { id },
      data: { status: ChatStatus.ARCHIVED },
    });
  }

  async updateLanguage(id: string, language: Language) {
    return this.prisma.chat.update({
      where: { id },
      data: { detectedLanguage: language },
    });
  }
}
