import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: 'Message cannot be empty' })
  @MaxLength(2000, { message: 'Message too long — max 2000 characters' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  content!: string;
}