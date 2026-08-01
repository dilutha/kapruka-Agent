import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateChatDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 80, { message: 'Title must be 1-80 characters' })
  title!: string;
}
