/**
 * Persisted Agent State — schema, types and parser
 *
 * The LangGraph `AgentState` (see `agent-orchestrator.ts`) is a *runtime* type:
 * it carries LangChain `BaseMessage` instances, reducers and transient fields
 * that must never round-trip through storage. What we persist between turns is
 * a deliberately narrow, JSON-safe subset — the "context state".
 *
 * That subset is defined here, once, with Zod:
 *
 *   • the Zod schemas are the single source of truth
 *   • the TypeScript types are *inferred* from them (`z.infer`), so schema and
 *     type can never drift apart
 *   • `agent-orchestrator.ts` imports these types and uses them inside
 *     `AgentStateAnnotation`, which makes `PersistedAgentState` a structural
 *     subset of `Partial<AgentState>` — checked by the compiler, not by a cast
 *
 * Storage layers (Postgres `chats.context_state` as `Json?`, Redis as a JSON
 * string) hand us untyped data. `parsePersistedAgentState()` is the *only*
 * sanctioned way back in: it validates and strips unknown keys, so malformed or
 * stale data becomes `null` instead of silently becoming an `AgentState`.
 */

import { Language } from '@prisma/client';
import { z } from 'zod';

// ─── Value object schemas ─────────────────────────────────────────────────────

export const kaprukProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  priceMin: z.number(),
  priceMax: z.number().optional(),
  currency: z.string(),
  isAvailable: z.boolean(),
  imageUrls: z.array(z.string()),
  description: z.string().optional(),
  /** Real kapruka.com product page — used for "Buy Now"/"View Product" links. */
  url: z.string().optional(),
  /** Real catalog signal (e.g. "low"/"medium"/"high"), never invented. */
  stockLevel: z.string().optional(),
});

export const cartItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.number().int().nonnegative(),
  unitPrice: z.number().nonnegative(),
});

export const addressSchema = z.object({
  recipientName: z.string(),
  phone: z.string(),
  addressLine1: z.string(),
  city: z.string(),
  /**
   * Kept for backward-compatible display only — the real
   * `kapruka_create_order` tool has no district field, only `address` +
   * `city` (validated against `kapruka_list_delivery_cities`). Never asked
   * for during checkout; never required to place an order.
   */
  district: z.string().optional(),
  postalCode: z.string().optional(),
});

export const giftMessageInputSchema = z.object({
  fromName: z.string(),
  toName: z.string(),
  message: z.string(),
  isAnonymous: z.boolean().optional(),
});

/**
 * Where the conversational checkout state machine is in collecting the
 * fields `kapruka_create_order` needs. `checkout.node.ts` reads this (via
 * `contextState.checkoutStep`) to know which field to ask for next, and
 * `chat.service.ts` reads it to keep the conversation "stuck" in checkout —
 * an address, phone number or date typed mid-flow must never be
 * misclassified as small talk.
 */
export const checkoutStepSchema = z.enum([
  'address',
  'delivery_date',
  'gift_message',
  'confirm',
  'placed',
]);

export const orderSummarySchema = z.object({
  itemsTotal: z.number(),
  deliveryFee: z.number(),
  addonsTotal: z.number(),
  grandTotal: z.number(),
  currency: z.string(),
});

export type KaprukProduct = z.infer<typeof kaprukProductSchema>;
export type CartItem = z.infer<typeof cartItemSchema>;
export type Address = z.infer<typeof addressSchema>;
export type GiftMessageInput = z.infer<typeof giftMessageInputSchema>;
export type CheckoutStep = z.infer<typeof checkoutStepSchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;

// ─── Persisted state ──────────────────────────────────────────────────────────

/**
 * The JSON-safe slice of `AgentState` that survives between turns.
 *
 * Every field is optional: a chat may have been persisted by an older build
 * that did not yet write it. Unknown keys are stripped (Zod's default object
 * behaviour), so removing a field from this schema automatically retires it
 * from every stored row without a migration.
 */
export const persistedAgentStateSchema = z.object({
  language: z.enum(Language).optional(),
  searchQuery: z.string().optional(),
  searchResults: z.array(kaprukProductSchema).optional(),
  selectedProduct: kaprukProductSchema.optional(),
  cartItems: z.array(cartItemSchema).optional(),
  shippingAddress: addressSchema.optional(),
  giftMessage: giftMessageInputSchema.optional(),
  /** YYYY-MM-DD — validated against `kapruka_check_delivery` before an order is placed. */
  deliveryDate: z.string().optional(),
  /** Pre-payment reference from `kapruka_create_order` — NOT the post-payment order number `kapruka_track_order` expects. */
  orderRef: z.string().optional(),
  /** Real Kapruka click-to-pay link returned alongside `orderRef`. */
  checkoutUrl: z.string().optional(),
  orderSummary: orderSummarySchema.optional(),
  checkoutStep: checkoutStepSchema.optional(),
  /** Last stated budget — lets "show cheaper ones" adjust relative to it. */
  budget: z.number().optional(),
});

export type PersistedAgentState = z.infer<typeof persistedAgentStateSchema>;

/**
 * Parses untrusted context state from any storage boundary.
 *
 * Accepts what the storage layers actually hand us:
 *  - `string`        — a Redis payload (JSON encoded)
 *  - `object`        — a Prisma `JsonValue` read straight from Postgres
 *  - `null` / other  — absent or wrong-shaped data
 *
 * Returns `null` for anything that is not a valid persisted state. It never
 * throws: a corrupt cache entry must degrade the conversation, not break it.
 */
export function parsePersistedAgentState(
  input: unknown,
): PersistedAgentState | null {
  const candidate = typeof input === 'string' ? tryParseJson(input) : input;

  // Reject primitives and arrays before Zod so `"null"`/`[]` cannot slip
  // through as an "empty" state.
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return null;
  }

  const result = persistedAgentStateSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

function tryParseJson(serialised: string): unknown {
  try {
    return JSON.parse(serialised);
  } catch {
    return null;
  }
}
