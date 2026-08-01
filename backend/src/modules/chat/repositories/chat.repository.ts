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

  async findByOwner(params: {
    userId?: string;
    guestUserId?: string;
    status?: ChatStatus;
  }) {
    return this.prisma.chat.findMany({
      where: {
        OR: [
          { userId: params.userId ?? undefined },
          { guestUserId: params.guestUserId ?? undefined },
        ],
        status: params.status ?? ChatStatus.ACTIVE,
      },
      // Pinned chats first, then most recently active — mirrors how the
      // sidebar groups and orders them.
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });
  }

  async setStatus(id: string, status: ChatStatus) {
    return this.prisma.chat.update({ where: { id }, data: { status } });
  }

  async setPinned(id: string, isPinned: boolean) {
    return this.prisma.chat.update({ where: { id }, data: { isPinned } });
  }

  async updateTitle(id: string, title: string) {
    return this.prisma.chat.update({
      where: { id },
      data: { title },
    });
  }

  async updateLanguage(id: string, language: Language) {
    return this.prisma.chat.update({
      where: { id },
      data: { detectedLanguage: language },
    });
  }

  /**
   * Creates a new chat that's a snapshot copy of `source` — same owner and
   * title (suffixed), independent from here on (renaming/deleting the copy
   * never touches the original, and vice versa).
   */
  async duplicate(source: Chat): Promise<Chat> {
    return this.prisma.chat.create({
      data: {
        userId: source.userId,
        guestUserId: source.guestUserId,
        title: source.title ? `${source.title} (copy)` : null,
        detectedLanguage: source.detectedLanguage,
      },
    });
  }
}
