/**
 * Security Configuration & Strategy
 * ===================================
 * Complete production security stack for the Kapruka Agent.
 *
 * LAYERS:
 *  1. Edge layer      — Vercel WAF, Cloudflare (optional), geo-blocking
 *  2. API Gateway     — Helmet, CORS, CSRF, rate limiting, request signing
 *  3. Auth layer      — Clerk JWT verification, guest session tokens
 *  4. Input layer     — Zod validation, sanitization, injection prevention
 *  5. AI layer        — Prompt injection guard, grounding enforcement
 *  6. Data layer      — Parameterized queries (Prisma), no raw SQL
 *  7. Secrets         — Environment variables only, never in code
 */

import {
  Injectable,
  NestMiddleware,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';
import { z } from 'zod';

// ─── 1. Helmet Configuration ──────────────────────────────────────────────────
// Hardened Content-Security-Policy for a chat application

export function buildHelmetConfig() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'", "'strict-dynamic'"],
        styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:         ["'self'", 'data:', 'https://*.kapruka.com', 'https://cdn.kapruka.com'],
        connectSrc:     ["'self'", 'https://api.kapruka.com', 'https://clerk.com'],
        mediaSrc:       ["'self'", 'blob:'],       // For TTS audio playback
        workerSrc:      ["'self'", 'blob:'],       // For voice activity detection worklet
        frameSrc:       ["'none'"],
        objectSrc:      ["'none'"],
        baseUri:        ["'self'"],
        formAction:     ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,   // Required for SharedArrayBuffer (voice worklet)
    hsts: {
      maxAge:            63_072_000,    // 2 years
      includeSubDomains: true,
      preload:           true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

// ─── 2. CORS Configuration ────────────────────────────────────────────────────

export function buildCorsConfig(allowedOrigins: string[]) {
  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (server-to-server, health checks)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: Origin ${origin} not allowed`));
      }
    },
    methods:            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders:     ['Content-Type', 'Authorization', 'X-Guest-Token', 'X-Request-ID'],
    exposedHeaders:     ['X-Request-ID', 'X-RateLimit-Remaining'],
    credentials:        true,
    maxAge:             86_400,         // 24h preflight cache
  };
}

// ─── 3. Rate Limiting ─────────────────────────────────────────────────────────

export function buildRateLimiters(redisUrl: string) {
  const redisClient = createClient({ url: redisUrl });
  redisClient.connect().catch(console.error);

  const store = new RedisStore({
    sendCommand: (...args: string[]) => redisClient.sendCommand(args),
  });

  return {
    // Global API rate limit
    global: rateLimit({
      windowMs:         60_000,          // 1 minute window
      max:              120,             // 120 requests per minute per IP
      standardHeaders:  'draft-7',
      legacyHeaders:    false,
      store,
      keyGenerator:     (req) => req.ip ?? 'unknown',
      skip:             (req) => req.path === '/health',
      message: {
        statusCode:     429,
        error:          'Too Many Requests',
        message:        'Rate limit exceeded. Please wait before trying again.',
      },
    }),

    // Chat endpoint — stricter limit to prevent abuse + cost control
    chat: rateLimit({
      windowMs:         60_000,
      max:              30,              // 30 messages per minute per user
      store,
      keyGenerator:     (req: Request) => {
        const userId = (req as any).user?.id ?? (req as any).guestUser?.id;
        return userId ? `chat:user:${userId}` : `chat:ip:${req.ip}`;
      },
      message: {
        statusCode:     429,
        error:          'Chat Rate Limited',
        message:        'Too many messages. Please wait a moment before sending another.',
      },
    }),

    // Auth endpoints — very strict to prevent brute force
    auth: rateLimit({
      windowMs:         15 * 60_000,    // 15 minutes
      max:              10,
      store,
      keyGenerator:     (req) => req.ip ?? 'unknown',
      message: {
        statusCode:     429,
        error:          'Auth Rate Limited',
        message:        'Too many authentication attempts. Please try again in 15 minutes.',
      },
    }),

    // Voice transcription — expensive API call, limit aggressively
    voice: rateLimit({
      windowMs:         60_000,
      max:              10,
      store,
      keyGenerator:     (req: Request) => {
        const userId = (req as any).user?.id;
        return userId ? `voice:${userId}` : `voice:ip:${req.ip}`;
      },
    }),
  };
}

// ─── 4. Guest Session Token Strategy ─────────────────────────────────────────

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

@Injectable()
export class GuestTokenService {
  private readonly HMAC_KEY: Buffer;
  private readonly TOKEN_EXPIRY_HOURS = 72; // 3 days

  constructor(private readonly config: ConfigService) {
    const secret = this.config.getOrThrow<string>('GUEST_TOKEN_SECRET');
    this.HMAC_KEY = Buffer.from(secret, 'hex');
  }

  /**
   * Generate a cryptographically signed guest token.
   * Format: {randomHex}.{timestamp}.{hmac}
   * The HMAC prevents forgery — guests can't manufacture valid tokens.
   */
  generate(): string {
    const id       = randomBytes(16).toString('hex');
    const ts       = Date.now().toString(36);
    const payload  = `${id}.${ts}`;
    const mac      = createHmac('sha256', this.HMAC_KEY)
                       .update(payload)
                       .digest('hex');
    return `${payload}.${mac}`;
  }

  /**
   * Verify token signature and expiry.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  verify(token: string): { valid: boolean; id?: string; expired?: boolean } {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const [id, tsHex, providedMac] = parts;
    const payload  = `${id}.${tsHex}`;
    const expected = createHmac('sha256', this.HMAC_KEY)
                       .update(payload)
                       .digest('hex');

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(providedMac.padEnd(expected.length, '0').slice(0, expected.length));

    // Timing-safe comparison
    if (expectedBuf.length !== providedBuf.length) return { valid: false };
    if (!timingSafeEqual(expectedBuf, providedBuf)) return { valid: false };

    // Check expiry
    const createdAt  = parseInt(tsHex, 36);
    const expiryMs   = this.TOKEN_EXPIRY_HOURS * 3_600_000;
    if (!Number.isFinite(createdAt) || createdAt > Date.now() + 60_000) {
      return { valid: false };
    }
    if (Date.now() - createdAt > expiryMs) {
      return { valid: false, expired: true };
    }

    return { valid: true, id };
  }
}

// ─── 5. Input Validation Schemas ─────────────────────────────────────────────

export const SendMessageSchema = z.object({
  content: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message too long — max 2000 characters')
    .transform((s) => s.trim()),
});

export const CheckoutAddressSchema = z.object({
  recipientName: z
    .string()
    .min(2, 'Name too short')
    .max(100)
    .regex(/^[\u0020-\u007E\u0D80-\u0DFF\s]+$/, 'Invalid characters in name'),
  phone: z
    .string()
    .regex(/^(\+94|0)?[1-9]\d{8}$/, 'Invalid Sri Lankan phone number'),
  addressLine1: z.string().min(5).max(200),
  city: z.string().min(2).max(100),
  district: z.enum([
    'Colombo', 'Gampaha', 'Kalutara', 'Kandy', 'Matale',
    'Nuwara Eliya', 'Galle', 'Matara', 'Hambantota', 'Jaffna',
    'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu', 'Batticaloa',
    'Ampara', 'Trincomalee', 'Kurunegala', 'Puttalam', 'Anuradhapura',
    'Polonnaruwa', 'Badulla', 'Monaragala', 'Ratnapura', 'Kegalle',
  ]),
});

export const GiftMessageSchema = z.object({
  fromName:    z.string().min(1).max(60),
  toName:      z.string().min(1).max(60),
  message:     z.string().min(1).max(150),
  isAnonymous: z.boolean().default(false),
});

// ─── 6. Secrets Management ────────────────────────────────────────────────────

/**
 * Required environment variables.
 * Validated on startup — missing secrets cause hard failure.
 * This prevents partial deployments with undefined credentials.
 */
export const RequiredSecretsSchema = z.object({
  // Database
  DATABASE_URL:             z.string().url(),
  DIRECT_URL:               z.string().url(),

  // Auth
  CLERK_SECRET_KEY:         z.string().startsWith('sk_'),
  CLERK_PUBLISHABLE_KEY:    z.string().startsWith('pk_'),
  GUEST_TOKEN_SECRET:       z.string().length(64), // 32 bytes hex

  // AI
  OPENAI_API_KEY:           z.string().startsWith('sk-'),

  // Redis
  REDIS_URL:                z.string(),

  // MCP
  KAPRUKA_MCP_SERVER_URL:   z.string().url(),

  // App
  NEXTJS_URL:               z.string().url(),
  CORS_ALLOWED_ORIGINS:     z.string(), // Comma-separated URLs

  // Optional but recommended
  SENTRY_DSN:               z.string().url().optional(),
  POSTHOG_KEY:              z.string().optional(),
});

export type RequiredSecrets = z.infer<typeof RequiredSecretsSchema>;

export function validateSecrets(env: NodeJS.ProcessEnv): RequiredSecrets {
  const result = RequiredSecretsSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues.map(
      (i) => `  ${i.path.join('.')}: ${i.message}`,
    );
    throw new Error(
      `\n❌ Missing or invalid environment variables:\n${missing.join('\n')}\n`,
    );
  }
  return result.data;
}

// ─── 7. PCI Considerations ────────────────────────────────────────────────────

/**
 * PCI Compliance Notes:
 *
 *  This application DOES NOT store, process, or transmit raw card data.
 *  All payment handling is delegated to:
 *   - Stripe (international cards) — tokenization via Stripe.js
 *   - PayHere (local Sri Lankan payments) — redirect to PayHere hosted page
 *   - Cash on Delivery — no card data involved
 *
 *  What we store (non-PCI):
 *   - Payment status (pending / captured / failed)
 *   - Provider reference ID (Stripe charge ID, PayHere ref)
 *   - Amount and currency
 *
 *  What we NEVER store:
 *   - Card number (PAN)
 *   - CVV / CVC
 *   - Expiry date
 *   - Full cardholder name on card
 *
 *  Tokenization happens entirely client-side (Stripe.js / PayHere SDK).
 *  The token is sent to our backend, which passes it to the provider API.
 *  We are a SAQ A merchant — the simplest PCI compliance tier.
 */
export const PCI_DISCLAIMER = `
Card payments are processed by Stripe / PayHere. 
Kapruka Agent never stores card numbers, CVV, or expiry dates.
` as const;
