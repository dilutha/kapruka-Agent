/**
 * Redis Service & Caching Strategy
 * ==================================
 * Central Redis client with typed helpers for every cache use-case.
 *
 * CACHE TOPOLOGY:
 *
 *  Key namespace      │ TTL     │ Purpose
 *  ─────────────────────────────────────────────────────────────
 *  product:search:{hash}   │ 30 min  │ Kapruka search results
 *  product:detail:{id}     │ 60 min  │ Full product detail
 *  product:recs:{hash}     │ 20 min  │ Recommendation results
 *  agent:state:{chatId}    │ 10 min  │ LangGraph state snapshot
 *  lang:detect:{b64hash}   │ 60 min  │ Language detection result
 *  session:{token}         │ 72 hr   │ Guest session data
 *  tracking:{orderId}      │ 5 min   │ Order tracking status
 *  slots:{district}:{date} │ 15 min  │ Delivery slot availability
 *  ratelimit:*             │ varies  │ Rate limit counters (managed by redis-rate-limit)
 *
 * CACHE INVALIDATION:
 *  - TTL-based expiry (primary strategy — products change infrequently)
 *  - Event-driven invalidation via NestJS EventEmitter for order state changes
 *  - Manual flush endpoint (admin only) for emergency cache clearing
 *
 * PATTERN:
 *  Cache-aside (lazy loading) for all read paths.
 *  Write-through for session and agent state (write must not fail silently).
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import * as crypto from 'crypto';

// ─── Cache TTLs (seconds) ─────────────────────────────────────────────────────

export const TTL = {
  PRODUCT_SEARCH:      30 * 60,    // 30 minutes
  PRODUCT_DETAIL:      60 * 60,    // 1 hour
  PRODUCT_RECS:        20 * 60,    // 20 minutes
  AGENT_STATE:         10 * 60,    // 10 minutes
  LANG_DETECT:         60 * 60,    // 1 hour
  GUEST_SESSION:       72 * 3600,  // 3 days
  ORDER_TRACKING:       5 * 60,    // 5 minutes
  DELIVERY_SLOTS:      15 * 60,    // 15 minutes
} as const;

// ─── Cache key builders ───────────────────────────────────────────────────────

export const CacheKey = {
  productSearch: (query: string, filters?: Record<string, unknown>) => {
    const hash = hashString(JSON.stringify({ query, ...(filters ?? {}) }));
    return `product:search:${hash}`;
  },
  productDetail: (id: string) => `product:detail:${id}`,
  productRecs: (params: Record<string, unknown>) =>
    `product:recs:${hashString(JSON.stringify(params))}`,
  agentState: (chatId: string) => `agent:state:${chatId}`,
  langDetect: (text: string) =>
    `lang:${Buffer.from(text.slice(0, 100)).toString('base64url')}`,
  guestSession: (token: string) => `session:${token}`,
  orderTracking: (orderId: string) => `tracking:${orderId}`,
  deliverySlots: (district: string, date: string) =>
    `slots:${district.toLowerCase()}:${date}`,
} as const;

function hashString(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

// ─── Redis Service ────────────────────────────────────────────────────────────

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: RedisClientType;
  private isConnected = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.client = createClient({
      url: this.config.getOrThrow<string>('redis.url'),
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) return new Error('Max Redis reconnection attempts exceeded');
          return Math.min(retries * 100, 3000);
        },
        connectTimeout: 5000,
      },
    }) as RedisClientType;

    this.client.on('error', (err) => {
      this.logger.error('Redis error:', err.message);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connected');
      this.isConnected = true;
    });

    this.client.on('reconnecting', () => {
      this.logger.warn('Redis reconnecting…');
    });

    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  // ─── Core operations ────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    if (!this.isConnected) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn(`Redis GET failed for ${key}:`, err);
      return null; // Degrade gracefully — never throw on cache miss
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.client.set(key, value);
    } catch (err) {
      this.logger.warn(`Redis SET failed for ${key}:`, err);
    }
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.client.setEx(key, ttlSeconds, value);
    } catch (err) {
      this.logger.warn(`Redis SETEX failed for ${key}:`, err);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Redis DEL failed for ${key}:`, err);
    }
  }

  async incr(key: string): Promise<number> {
    if (!this.isConnected) return 0;
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    if (!this.isConnected) return;
    await this.client.expire(key, seconds);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConnected) return false;
    const result = await this.client.exists(key);
    return result === 1;
  }

  // ─── Pattern delete (for cache busting) ─────────────────────────────────────

  async deletePattern(pattern: string): Promise<number> {
    if (!this.isConnected) return 0;
    let cursor = 0;
    let deletedCount = 0;

    do {
      const result = await this.client.scan(cursor, {
        MATCH:  pattern,
        COUNT:  100,
      });
      cursor = result.cursor;

      if (result.keys.length > 0) {
        await this.client.del(result.keys);
        deletedCount += result.keys.length;
      }
    } while (cursor !== 0);

    this.logger.log(`Deleted ${deletedCount} keys matching ${pattern}`);
    return deletedCount;
  }

  // ─── Typed cache helpers ─────────────────────────────────────────────────────

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      await this.del(key); // Corrupted value — evict
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.setEx(key, ttlSeconds, JSON.stringify(value));
  }

  // ─── Cache-aside helper ──────────────────────────────────────────────────────

  /**
   * Generic cache-aside pattern.
   * Checks cache first, calls loader on miss, stores result with TTL.
   *
   * Usage:
   *   const product = await redis.remember(
   *     CacheKey.productDetail(id),
   *     TTL.PRODUCT_DETAIL,
   *     () => kaprukaMcp.getProductDetails(id),
   *   );
   */
  async remember<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== null) return cached;

    const value = await loader();
    await this.setJson(key, value, ttlSeconds);
    return value;
  }

  // ─── Health check ─────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    if (!this.isConnected) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  getStatus(): { connected: boolean } {
    return { connected: this.isConnected };
  }
}