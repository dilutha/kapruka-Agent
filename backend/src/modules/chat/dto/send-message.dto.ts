import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Mirrors the frontend Zustand cart slice's `CartItem` shape
 * (frontend/src/stores/kapruk.store.ts) — the cart lives in the browser, not
 * the backend, so every message that could touch checkout carries a fresh
 * snapshot along with it. See ChatService.sendMessageStream() and
 * AgentOrchestrator's `cartItemsOverride`.
 */
export class CartItemDto {
  @IsString()
  @MaxLength(80)
  kaprukaProdId!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: 'Message cannot be empty' })
  @MaxLength(2000, { message: 'Message too long — max 2000 characters' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  content!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  cartItems?: CartItemDto[];
}
