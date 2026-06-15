export class ChatResponseDto {
  id!:               string;
  title?:            string;
  detectedLanguage!: string;
  messages!:         MessageResponseDto[];
  createdAt!:        Date;
  updatedAt!:        Date;

  static fromEntity(chat: any): ChatResponseDto {
    const dto = new ChatResponseDto();
    dto.id               = chat.id;
    dto.title            = chat.title;
    dto.detectedLanguage = chat.detectedLanguage;
    dto.messages         = (chat.messages ?? []).map((m: any) => ({
      id:        m.id,
      role:      m.role,
      content:   m.content,
      toolCalls: m.toolCalls,
      metadata:  m.metadata,
      createdAt: m.createdAt,
    }));
    dto.createdAt = chat.createdAt;
    dto.updatedAt = chat.updatedAt;
    return dto;
  }
}

class MessageResponseDto {
  id!:        string;
  role!:      string;
  content!:   string;
  toolCalls?: unknown;
  metadata?:  unknown;
  createdAt!: Date;
}