import { Chat, Message, MessageRole } from '@prisma/client';
import {
  parsePersistedAgentState,
  type PersistedAgentState,
} from '../../../ai/agent/state/agent-state.schema';

type ChatWithMessages = Chat & { messages?: Message[] };

class MessageResponseDto {
  id!: string;
  role!: 'user' | 'assistant' | 'system' | 'tool';
  content!: string;
  toolCalls?: unknown;
  metadata?: unknown;
  createdAt!: Date;
}

export class ChatResponseDto {
  id!: string;
  title?: string;
  detectedLanguage!: string;
  status!: string;
  isPinned!: boolean;
  messages!: MessageResponseDto[];
  /**
   * AI-collected shopping/checkout context (cart, shipping address,
   * checkout progress, order info) — validated through the same
   * `parsePersistedAgentState()` gate every other storage boundary in this
   * app uses, never the raw DB `Json?` column. Lets the frontend's
   * `/checkout` page show what the assistant already collected instead of
   * asking the shopper to repeat themselves in a separate form.
   */
  contextState!: PersistedAgentState | null;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(chat: ChatWithMessages): ChatResponseDto {
    const dto = new ChatResponseDto();
    dto.id = chat.id;
    dto.title = chat.title ?? undefined;
    dto.detectedLanguage = chat.detectedLanguage;
    dto.status = chat.status;
    dto.isPinned = chat.isPinned;
    dto.messages = (chat.messages ?? []).map((message) => ({
      id: message.id,
      role: mapMessageRole(message.role),
      content: message.content,
      toolCalls: message.toolCalls,
      metadata: message.metadata,
      createdAt: message.createdAt,
    }));
    dto.contextState = parsePersistedAgentState(chat.contextState);
    dto.createdAt = chat.createdAt;
    dto.updatedAt = chat.updatedAt;
    return dto;
  }
}

function mapMessageRole(role: MessageRole): MessageResponseDto['role'] {
  switch (role) {
    case MessageRole.USER:
      return 'user';
    case MessageRole.ASSISTANT:
      return 'assistant';
    case MessageRole.SYSTEM:
      return 'system';
    case MessageRole.TOOL:
      return 'tool';
  }
}
