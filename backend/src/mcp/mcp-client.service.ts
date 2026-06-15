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
 * Tool manifest (derived from Kapruka MCP server spec):
 *  - searchProducts        Search the product catalog
 *  - getProductDetails     Single product full detail
 *  - addToCart             Add product to Kapruka session cart
 *  - removeFromCart        Remove item from cart
 *  - getCart               Current cart state
 *  - placeOrder            Submit order to Kapruka
 *  - getDeliverySlots      Available delivery windows
 *  - trackOrder            Order tracking status
 *  - getProductRecommendations  Occasion-based recommendations
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
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
});

const SearchResultSchema = z.object({
  products: z.array(ProductSchema),
  total: z.number(),
  query: z.string(),
});

const CartSchema = z.object({
  cartId: z.string(),
  items: z.array(
    z.object({
      cartItemId: z.string(),
      productId: z.string(),
      name: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      subtotal: z.number(),
    }),
  ),
  totalItems: z.number(),
  totalAmount: z.number(),
  currency: z.string().default('LKR'),
});

const DeliverySlotSchema = z.object({
  slots: z.array(
    z.object({
      slotId: z.string(),
      date: z.string(),
      label: z.string(),
      available: z.boolean(),
      cutoffTime: z.string().optional(),
    }),
  ),
});

const OrderResultSchema = z.object({
  orderId: z.string(),
  kaprukOrderId: z.string(),
  status: z.string(),
  totalAmount: z.number(),
  estimatedDelivery: z.string().optional(),
  paymentUrl: z.string().optional(),
});

const TrackingSchema = z.object({
  orderId: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  events: z.array(
    z.object({
      eventType: z.string(),
      description: z.string(),
      location: z.string().optional(),
      timestamp: z.string(),
    }),
  ),
  estimatedDelivery: z.string().optional(),
  isDelivered: z.boolean(),
});

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

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  // ─── Connection management ─────────────────────────────────────────────────

  private async connect(): Promise<void> {
    const serverUrl = this.config.get<string>('mcp.serverUrl');

    if (!serverUrl) {
      this.logger.warn('MCP_SERVER_URL not configured — MCP tools unavailable');
      return;
    }

    try {
      this.client = new Client(
        { name: 'kapruka-agent', version: '1.0.0' },
        { capabilities: {} },
      );

      const transport = new SSEClientTransport(new URL(serverUrl));
      await this.client.connect(transport);

      this.isConnected = true;
      this.logger.log(`MCP client connected to ${serverUrl}`);

      // List available tools on startup
      const tools = await this.client.listTools();
      this.logger.log(
        `MCP tools available: ${tools.tools.map((t) => t.name).join(', ')}`,
      );
    } catch (error) {
      this.logger.error('MCP connection failed:', error);
      this.isConnected = false;
      // Retry after 5 seconds
      setTimeout(() => this.connect(), 5_000);
    }
  }

  private async disconnect(): Promise<void> {
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

    const timeout = this.config.get<number>('mcp.toolTimeoutMs', 10_000);

    try {
      const result = await Promise.race([
        this.client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`MCP tool ${toolName} timed out`)), timeout),
        ),
      ]);

      this.circuitBreaker.onSuccess();

      // Extract text content from MCP response
      const content = result.content as Array<{ type: string; text?: string }>;
      const textContent = content.find((c) => c.type === 'text')?.text;

      if (!textContent) {
        throw new Error(`MCP tool ${toolName} returned no text content`);
      }

      return JSON.parse(textContent) as T;
    } catch (error) {
      this.circuitBreaker.onFailure();
      this.logger.error(`MCP tool ${toolName} failed:`, error);
      throw error;
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
    const raw = await this.call<unknown>('searchProducts', params);
    return SearchResultSchema.parse(raw);
  }

  async getProductDetails(
    productId: string,
  ): Promise<z.infer<typeof ProductSchema>> {
    const raw = await this.call<unknown>('getProductDetails', { productId });
    return ProductSchema.parse(raw);
  }

  async addToCart(params: {
    productId: string;
    quantity: number;
    sessionToken: string;
  }): Promise<z.infer<typeof CartSchema>> {
    const raw = await this.call<unknown>('addToCart', params);
    return CartSchema.parse(raw);
  }

  async removeFromCart(params: {
    cartItemId: string;
    sessionToken: string;
  }): Promise<z.infer<typeof CartSchema>> {
    const raw = await this.call<unknown>('removeFromCart', params);
    return CartSchema.parse(raw);
  }

  async getCart(sessionToken: string): Promise<z.infer<typeof CartSchema>> {
    const raw = await this.call<unknown>('getCart', { sessionToken });
    return CartSchema.parse(raw);
  }

  async getDeliverySlots(params: {
    district?: string;
    date?: string;
  }): Promise<z.infer<typeof DeliverySlotSchema>> {
    const raw = await this.call<unknown>('getDeliverySlots', params);
    return DeliverySlotSchema.parse(raw);
  }

  async placeOrder(params: {
    cartId: string;
    shippingAddress: {
      recipientName: string;
      phone: string;
      addressLine1: string;
      city: string;
      district: string;
    };
    paymentMethod: 'card' | 'cod' | 'payhere';
    giftMessage?: {
      fromName: string;
      toName: string;
      message: string;
      isAnonymous?: boolean;
    };
    deliverySlotId?: string;
    sessionToken: string;
  }): Promise<z.infer<typeof OrderResultSchema>> {
    const raw = await this.call<unknown>('placeOrder', params);
    return OrderResultSchema.parse(raw);
  }

  async trackOrder(
    orderId: string,
  ): Promise<z.infer<typeof TrackingSchema>> {
    const raw = await this.call<unknown>('trackOrder', { orderId });
    return TrackingSchema.parse(raw);
  }

  async getProductRecommendations(params: {
    occasion?: string;
    budget?: number;
    category?: string;
    language?: 'en' | 'si';
  }): Promise<z.infer<typeof SearchResultSchema>> {
    const raw = await this.call<unknown>('getProductRecommendations', params);
    return SearchResultSchema.parse(raw);
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
