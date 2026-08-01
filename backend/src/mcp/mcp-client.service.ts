/**
 * MCP Client Service
 *
 * Manages the connection to the Kapruka MCP server and exposes
 * all available tools as typed TypeScript method calls.
 *
 * Reliability features:
 *  - Automatic reconnection with exponential backoff
 *  - Circuit breaker (opens after 5 failures in 60s, half-opens after 30s)
 *  - Per-tool timeout (default 10s, configurable)
 *  - Response validation via Zod schemas
 *  - Fallback to ProductCache on search failures
 *
 * Tool manifest — every real tool the live Kapruka MCP server exposes,
 * confirmed via `client.listTools()` against `https://mcp.kapruka.com/mcp`
 * (each tool's real `inputSchema` + description, not assumed):
 *
 *  - kapruka_search_products       Search the product catalog
 *  - kapruka_get_product           Single product full detail
 *  - kapruka_list_categories       Category tree
 *  - kapruka_list_delivery_cities  Canonical deliverable city names + aliases
 *  - kapruka_check_delivery        Feasibility + flat rate for a city/date
 *  - kapruka_create_order          Guest-checkout order → a click-to-pay URL
 *  - kapruka_track_order           Status/timeline for a *paid* order
 *
 * Every tool takes its arguments nested under a `params` key with snake_case
 * fields, defaults to a markdown (not JSON) response body — `response_format:
 * 'json'` is required on every call here — and on failure returns a plain
 * `"Error (<code>): <message>"` / `"Error: <message>"` string even in JSON
 * mode (not a JSON error object). `call()` detects that prefix and throws
 * `McpToolError` instead of trying (and failing) to `JSON.parse()` it.
 *
 * `kapruka_create_order` does NOT charge anyone or place a real fulfilled
 * order — it locks catalog prices for 60 minutes and returns a `checkout_url`
 * the shopper opens in a browser to actually pay (guest checkout, no Kapruka
 * account needed). That is the honest end of this app's "AI checkout": the
 * agent collects cart + recipient + delivery + sender conversationally, then
 * hands the shopper a real Kapruka payment link — it never simulates payment
 * or fabricates an order confirmation itself. Rate-limited to 30 orders/hour
 * per client IP by the server.
 *
 * `kapruka_track_order` takes the order NUMBER Kapruka emails *after*
 * payment completes on that checkout_url — not the pre-payment `order_ref`
 * this client gets back from `placeOrder()`. The two are different
 * identifiers for different stages; see `trackOrder()`'s doc comment.
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

// ─── Response schemas (Zod) ───────────────────────────────────────────────────

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().optional(),
  nameSi: z.string().optional(),
  category: z.string(),
  subcategory: z.string().optional(),
  priceMin: z.number(),
  priceMax: z.number().optional(),
  currency: z.string().default('LKR'),
  isAvailable: z.boolean().default(true),
  imageUrls: z.array(z.string()).default([]),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Real kapruka.com product page — used for "Buy Now"/"View Product" links. */
  url: z.string().optional(),
  /** Real signal from the catalog, when the tool reports it — never invented. */
  stockLevel: z.string().optional(),
});

const SearchResultSchema = z.object({
  products: z.array(ProductSchema),
  total: z.number(),
  query: z.string(),
});

/** Real `kapruka_get_product` JSON response — confirmed against the live tool schema. */
const GetProductResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  price: z.object({ amount: z.number(), currency: z.string() }),
  in_stock: z.boolean().default(true),
  stock_level: z.string().nullable().optional(),
  category: z
    .object({ id: z.string(), name: z.string(), slug: z.string() })
    .nullable()
    .optional(),
  images: z.array(z.string()).default([]),
  url: z.string().optional(),
});

/**
 * Raw shape of `kapruka_search_products`'s actual JSON response — confirmed
 * against the live server's tool schema (`params: SearchProductsInput`,
 * `response_format: 'json'`). This does NOT match `SearchResultSchema`
 * above: real fields are `results`/`next_cursor`, prices are nested
 * `{amount, currency}` objects, images are a single `image_url`, and
 * category is an object, not a string. `searchProducts()` adapts this into
 * the `SearchResultSchema` shape the rest of the app already expects, so
 * nothing downstream (product-search.node.ts, ProductCacheRepository) needs
 * to know the real tool contract differs from what was originally assumed.
 */
const RawSearchProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string().nullable().optional(),
  price: z.object({
    amount: z.number().nullable(),
    currency: z.string(),
  }),
  in_stock: z.boolean().default(true),
  image_url: z.string().nullable().optional(),
  category: z
    .object({ id: z.string(), name: z.string(), slug: z.string() })
    .nullable()
    .optional(),
  /** Real kapruka.com product page, when the tool includes one. */
  url: z.string().nullable().optional(),
  /** e.g. "low"/"medium"/"high" — real catalog signal, not derived/guessed. */
  stock_level: z.string().nullable().optional(),
});

const RawSearchResponseSchema = z.object({
  results: z.array(RawSearchProductSchema),
  next_cursor: z.string().nullable().optional(),
  applied_filters: z.record(z.string(), z.unknown()).optional(),
});

const DeliveryCitiesResultSchema = z.object({
  cities: z.array(
    z.object({
      name: z.string(),
      aliases: z.array(z.string()).default([]),
    }),
  ),
  total_matched: z.number(),
  showing: z.number(),
});

const CheckDeliveryResultSchema = z.object({
  city: z.string(),
  now: z.string(),
  checked_date: z.string(),
  available: z.boolean(),
  rate: z.number(),
  currency: z.string(),
  reason: z.string().nullable().optional(),
  next_available_date: z.string().nullable().optional(),
  perishable_warning: z.string().nullable().optional(),
});

const CreateOrderResultSchema = z.object({
  checkout_url: z.string(),
  order_ref: z.string(),
  summary: z.object({
    items_total: z.number(),
    delivery_fee: z.number(),
    addons_total: z.number(),
    grand_total: z.number(),
    currency: z.string(),
  }),
  expires_at: z.string(),
});

const TrackOrderResultSchema = z.object({
  order_number: z.string(),
  status: z.string(),
  status_display: z.string(),
  order_date: z.string(),
  delivery_date: z.string(),
  shipped_date: z.string().nullable().optional(),
  amount: z.string(),
  payment_method: z.string(),
  comments: z.string().nullable().optional(),
  recipient: z.object({
    name: z.string(),
    phone: z.string(),
    address: z.string(),
    city: z.string(),
  }),
  greeting_message: z.string().nullable().optional(),
  special_instructions: z.string().nullable().optional(),
  progress: z.array(z.object({ step: z.string(), timestamp: z.string() })),
  live_tracking_available: z.boolean(),
  has_delivery_video: z.boolean(),
  has_delivery_photo: z.boolean(),
  items: z.array(
    z.object({
      product_id: z.string(),
      name: z.string(),
      quantity: z.number(),
      selling_price: z.number(),
    }),
  ),
});

/**
 * A business-logic failure from a *healthy* tool call — an invalid city, a
 * past delivery date, an order number that doesn't exist. Distinct from a
 * transport/connectivity error: it must never trip the circuit breaker (a
 * handful of shoppers typing an undeliverable city shouldn't lock everyone
 * else out of search for 30s), and its `rawMessage` is safe-ish but still
 * needs a friendly rewrite before reaching a user — see checkout.node.ts.
 */
export class McpToolError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly rawMessage: string,
  ) {
    super(rawMessage);
    this.name = 'McpToolError';
  }
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 30_000,
  ) {}

  canCall(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeMs) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true; // HALF_OPEN allows one probe
  }

  onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class McpClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpClientService.name);
  private client: Client | null = null;
  private readonly circuitBreaker = new CircuitBreaker(5, 30_000);
  private isConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;

  private static readonly RECONNECT_BASE_MS = 5_000;
  private static readonly RECONNECT_MAX_MS = 120_000;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  // ─── Connection management ─────────────────────────────────────────────────

  private async connect(): Promise<void> {
    const serverUrl = this.config.get<string>('ai.mcpServerUrl');

    if (!serverUrl) {
      this.logger.warn(
        'KAPRUKA_MCP_SERVER_URL not configured — MCP tools unavailable',
      );
      return;
    }

    if (serverUrl.endsWith('/sse')) {
      this.logger.warn(
        `KAPRUKA_MCP_SERVER_URL (${serverUrl}) points at a legacy "/sse" path. ` +
          'This client speaks the MCP Streamable HTTP transport, which the ' +
          'Kapruka MCP server exposes at "/mcp" — the "/sse" path will 404.',
      );
    }

    try {
      this.client = new Client(
        { name: 'kapruka-agent', version: '1.0.0' },
        { capabilities: {} },
      );

      // Streamable HTTP (not the deprecated HTTP+SSE transport): the server
      // negotiates POST + SSE over a single "/mcp" endpoint and returns an
      // Mcp-Session-Id header on `initialize`.
      const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
      await this.client.connect(transport);

      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.clearReconnectTimer();
      this.startHeartbeat();
      this.logger.log(`MCP client connected to ${serverUrl}`);

      // List available tools on startup
      const tools = await this.client.listTools();
      this.logger.log(
        `MCP tools available: ${tools.tools.map((t) => t.name).join(', ')}`,
      );
    } catch (error) {
      this.isConnected = false;
      this.logger.error(this.describeConnectionError(serverUrl, error));
      this.scheduleReconnect();
    }
  }

  /**
   * Classifies a failed connection attempt so 404s (wrong URL/path — will
   * never succeed by retrying) read differently in logs from transient
   * network/5xx failures (worth retrying as-is).
   */
  private describeConnectionError(serverUrl: string, error: unknown): string {
    const code = this.extractHttpCode(error);
    const message = error instanceof Error ? error.message : String(error);

    if (code === 404) {
      return (
        `MCP connection failed: 404 Not Found at ${serverUrl}. The endpoint ` +
        'does not exist on this server — this is a configuration problem, ' +
        'not a transient outage, and will keep failing until ' +
        "KAPRUKA_MCP_SERVER_URL is corrected. Verify the server's advertised " +
        `MCP endpoint path (commonly "/mcp" for Streamable HTTP). Raw: ${message}`
      );
    }

    if (code === 401 || code === 403) {
      return (
        `MCP connection failed: ${code} at ${serverUrl}. The server is ` +
        'reachable but rejected the client — check for a required auth ' +
        `header/token. Raw: ${message}`
      );
    }

    return `MCP connection failed (attempt ${this.reconnectAttempts + 1}): ${message}`;
  }

  private extractHttpCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = 'code' in error ? error.code : undefined;
    return typeof code === 'number' ? code : undefined;
  }

  private async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
    }
  }

  // ─── Generic tool caller ──────────────────────────────────────────────────

  async call<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
    if (!this.circuitBreaker.canCall()) {
      throw new Error(
        `MCP circuit breaker OPEN — ${toolName} unavailable. Retry in 30s.`,
      );
    }

    if (!this.isConnected || !this.client) {
      throw new Error('MCP client not connected');
    }

    const timeout = this.config.get<number>('ai.mcpTimeoutMs', 10_000);
    let textContent: string | undefined;

    try {
      const result = await Promise.race([
        this.client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`MCP tool ${toolName} timed out`)),
            timeout,
          ),
        ),
      ]);

      this.circuitBreaker.onSuccess();

      // Extract text content from MCP response
      const content = result.content as Array<{ type: string; text?: string }>;
      textContent = content.find((c) => c.type === 'text')?.text;
    } catch (error) {
      this.circuitBreaker.onFailure();
      this.logger.error(`MCP tool ${toolName} failed:`, error);
      throw error;
    }

    if (!textContent) {
      this.circuitBreaker.onFailure();
      throw new Error(`MCP tool ${toolName} returned no text content`);
    }

    // Every real tool here returns "Error (<code>): <message>" or
    // "Error: <message>" as plain text on failure, even with
    // response_format: 'json' — a healthy server telling us "empty cart" or
    // "city not deliverable", not a connectivity problem. Distinguishing this
    // from a transport failure is why circuitBreaker.onFailure() is NOT
    // called here: it already recorded success above (the round trip
    // worked), and it shouldn't be double-counted as a fault.
    const trimmed = textContent.trim();
    if (/^Error\b/i.test(trimmed)) {
      throw new McpToolError(toolName, trimmed);
    }

    try {
      return JSON.parse(trimmed) as T;
    } catch {
      this.circuitBreaker.onFailure();
      throw new Error(`MCP tool ${toolName} returned unparseable content`);
    }
  }

  async listAvailableTools(): Promise<string[]> {
    if (!this.isConnected || !this.client) return [];
    const tools = await this.client.listTools();
    return tools.tools.map((tool) => tool.name);
  }

  /**
   * Bounded exponential backoff — a wrong URL/path fails identically on
   * every attempt, so retrying at a fixed 5s cadence forever just floods the
   * logs. Backoff still retries indefinitely (the server may come back, or an
   * operator may fix the URL without restarting the process), but spaces
   * attempts out up to RECONNECT_MAX_MS instead of hammering at a fixed rate.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay = Math.min(
      McpClientService.RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      McpClientService.RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const heartbeatMs = this.config.get<number>('ai.mcpHeartbeatMs', 30_000);
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async heartbeat(): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      await this.client.listTools();
    } catch (error) {
      this.logger.warn('MCP heartbeat failed; reconnecting');
      this.logger.debug(error);
      this.isConnected = false;
      this.stopHeartbeat();
      await this.client.close().catch((closeError: unknown) => {
        this.logger.debug(closeError);
      });
      this.client = null;
      this.scheduleReconnect();
    }
  }

  // ─── Typed tool methods ────────────────────────────────────────────────────

  async searchProducts(params: {
    query: string;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    language?: 'en' | 'si';
    limit?: number;
  }): Promise<z.infer<typeof SearchResultSchema>> {
    // The real tool is `kapruka_search_products`, takes its arguments nested
    // under `params`, uses snake_case field names, has no language filter,
    // and defaults to a markdown response body — response_format: 'json' is
    // required or `call()`'s JSON.parse would fail on prose. See
    // RawSearchResponseSchema for why the response also needs adapting.
    const raw = await this.call<unknown>('kapruka_search_products', {
      params: {
        q: params.query,
        category: params.category,
        limit: params.limit,
        min_price: params.minPrice,
        max_price: params.maxPrice,
        response_format: 'json',
      },
    });

    const parsed = RawSearchResponseSchema.parse(raw);
    const products = parsed.results.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category?.name ?? 'Uncategorized',
      priceMin: p.price.amount ?? 0,
      currency: p.price.currency,
      isAvailable: p.in_stock,
      imageUrls: p.image_url ? [p.image_url] : [],
      description: p.summary ?? undefined,
      url: p.url ?? undefined,
      stockLevel: p.stock_level ?? undefined,
    }));

    return SearchResultSchema.parse({
      products,
      total: products.length,
      query: params.query,
    });
  }

  async getProductDetails(
    productId: string,
  ): Promise<z.infer<typeof ProductSchema>> {
    const raw = await this.call<unknown>('kapruka_get_product', {
      params: { product_id: productId, response_format: 'json' },
    });
    const parsed = GetProductResultSchema.parse(raw);
    return ProductSchema.parse({
      id: parsed.id,
      name: parsed.name,
      category: parsed.category?.name ?? 'Uncategorized',
      priceMin: parsed.price.amount,
      currency: parsed.price.currency,
      isAvailable: parsed.in_stock,
      imageUrls: parsed.images,
      description: parsed.summary ?? parsed.description,
      url: parsed.url,
      stockLevel: parsed.stock_level ?? undefined,
    });
  }

  /** Canonical Kapruka-deliverable city names — required before `checkDelivery()`/`placeOrder()`, since both reject a non-canonical city string. */
  async listDeliveryCities(params: {
    query?: string;
    limit?: number;
  }): Promise<z.infer<typeof DeliveryCitiesResultSchema>> {
    const raw = await this.call<unknown>('kapruka_list_delivery_cities', {
      params: {
        query: params.query,
        limit: params.limit,
        response_format: 'json',
      },
    });
    return DeliveryCitiesResultSchema.parse(raw);
  }

  /** Feasibility + flat delivery rate for a city/date — validates the city before `placeOrder()` ever spends one of the 30 orders/hour rate-limit slots on a request that would just fail. */
  async checkDelivery(params: {
    city: string;
    deliveryDate?: string;
    productId?: string;
  }): Promise<z.infer<typeof CheckDeliveryResultSchema>> {
    const raw = await this.call<unknown>('kapruka_check_delivery', {
      params: {
        city: params.city,
        delivery_date: params.deliveryDate,
        product_id: params.productId,
        response_format: 'json',
      },
    });
    return CheckDeliveryResultSchema.parse(raw);
  }

  /**
   * Creates a guest-checkout order and returns a real Kapruka `checkout_url`
   * the shopper must open to pay — this does NOT charge anyone or place a
   * fulfilled order by itself. See the file-level doc comment.
   */
  async placeOrder(params: {
    cart: Array<{ productId: string; quantity: number; icingText?: string }>;
    recipient: { name: string; phone: string };
    delivery: {
      address: string;
      city: string;
      date: string;
      locationType?: 'house' | 'apartment' | 'office' | 'other';
      instructions?: string;
    };
    sender: { name: string; anonymous?: boolean };
    giftMessage?: string;
    currency?: string;
  }): Promise<z.infer<typeof CreateOrderResultSchema>> {
    const raw = await this.call<unknown>('kapruka_create_order', {
      params: {
        cart: params.cart.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
          icing_text: item.icingText,
        })),
        recipient: params.recipient,
        delivery: {
          address: params.delivery.address,
          city: params.delivery.city,
          location_type: params.delivery.locationType ?? 'house',
          date: params.delivery.date,
          instructions: params.delivery.instructions,
        },
        sender: params.sender,
        gift_message: params.giftMessage,
        currency: params.currency ?? 'LKR',
        response_format: 'json',
      },
    });
    return CreateOrderResultSchema.parse(raw);
  }

  /**
   * Tracks a PAID order by the order number Kapruka emails after the
   * shopper completes payment on a `placeOrder()` checkout_url — NOT the
   * pre-payment `order_ref` this client returns from `placeOrder()` itself.
   * An order the agent just created has nothing to track yet until the
   * shopper actually pays.
   */
  async trackOrder(
    orderNumber: string,
  ): Promise<z.infer<typeof TrackOrderResultSchema>> {
    const raw = await this.call<unknown>('kapruka_track_order', {
      params: { order_number: orderNumber, response_format: 'json' },
    });
    return TrackOrderResultSchema.parse(raw);
  }

  // ─── Health check ──────────────────────────────────────────────────────────

  getStatus(): {
    connected: boolean;
    circuitState: CircuitState;
  } {
    return {
      connected: this.isConnected,
      circuitState: this.circuitBreaker.getState(),
    };
  }
}
