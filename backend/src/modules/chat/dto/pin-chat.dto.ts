import { IsBoolean } from 'class-validator';

export class PinChatDto {
  @IsBoolean()
  isPinned!: boolean;
}
