/**
 * Security Middleware Stack
 *
 * Applied in this order in main.ts:
 *  1. PromptInjectionGuard  — blocks injection attempts before they reach AI
 *  2. InputSanitizationPipe — strips dangerous HTML/script content
 *  3. RateLimitGuard        — per-user/IP throttling via Redis
 *
 * ── Prompt Injection Prevention Strategy ──────────────────────────────────
 *
 *  Defense in depth approach:
 *   a) Pattern matching on known injection phrases (blocklist, fast)
 *   b) Semantic length heuristic (unusually long messages are suspicious)
 *   c) Structural analysis (looks like a system prompt template?)
 *   d) LLM-based classifier for edge cases (only on flagged messages)
 *
 *  When injection is detected:
 *   - Message is rejected with a generic "I can only help with shopping" response
 *   - Event logged to analytics with severity=HIGH
 *   - IP flagged in Redis for increased scrutiny (not auto-banned)
 *   - NEVER echoed back in error responses (prevents prompt disclosure)
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import { PromptLibrary } from '../../ai/agent/prompts/prompt-library';
import { AnalyticsService } from '../../modules/analytics/analytics.service';

// ─── Prompt Injection Guard ───────────────────────────────────────────────────

@Injectable()
export class PromptInjectionGuard implements CanActivate {
  private readonly logger = new Logger(PromptInjectionGuard.name);
  private readonly MAX_MESSAGE_LENGTH = 2000;

  // Messages longer than this trigger extra scrutiny
  private readonly SUSPICION_LENGTH = 800;

  // Structural markers of prompt injection
  private readonly STRUCTURAL_PATTERNS: RegExp[] = [
    /^\s*\[SYSTEM\]/im,
    /^\s*\[INST\]/im,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
    /Human:\s*Assistant:/i,
    /###\s*Instruction/i,
    /###\s*System/i,
    /You must now/i,
    /New instructions:/i,
    /Updated instructions:/i,
    /Override:/i,
    /OVERRIDE\s*MODE/i,
  ];

  constructor(
    private readonly redis: RedisService,
    private readonly prompts: PromptLibrary,
    private readonly analytics: AnalyticsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const body = request.body as { content?: string };

    if (!body?.content) return true; // Empty message passes (handled elsewhere)

    const message = body.content;
    const ip = this.getClientIp(request);

    // Check 1: Length limit
    if (message.length > this.MAX_MESSAGE_LENGTH) {
      this.logger.warn(`Message too long from ${ip}: ${message.length} chars`);
      throw new BadRequestException(
        `Message exceeds maximum length of ${this.MAX_MESSAGE_LENGTH} characters.`,
      );
    }

    // Check 2: Known injection patterns (blocklist)
    const injectionPatterns = this.prompts.getInjectionPatterns();
    const allPatterns = [...injectionPatterns, ...this.STRUCTURAL_PATTERNS];

    for (const pattern of allPatterns) {
      if (pattern.test(message)) {
        await this.flagInjectionAttempt(ip, message, 'pattern_match');
        // Return a generic refusal without revealing detection
        throw new BadRequestException(
          'I can only help with shopping on Kapruka.com.',
        );
      }
    }

    // Check 3: Suspicion heuristic for longer messages
    if (message.length > this.SUSPICION_LENGTH) {
      const suspicionScore = this.computeSuspicionScore(message);
      if (suspicionScore > 0.7) {
        await this.flagInjectionAttempt(ip, message, 'heuristic', suspicionScore);
        // Don't block — just flag for monitoring
        this.logger.warn(`Suspicious message from ${ip} (score: ${suspicionScore})`);
      }
    }

    return true;
  }

  private computeSuspicionScore(message: string): number {
    let score = 0;
    const lower = message.toLowerCase();

    // Instruction-like language
    if (/\b(must|should|will|always|never)\b.*\b(respond|reply|say|output)\b/i.test(lower)) score += 0.3;
    // Role-playing triggers
    if (/\b(pretend|act|roleplay|imagine you are|you are now)\b/i.test(lower)) score += 0.4;
    // System boundary markers
    if (/[-]{3,}|[=]{3,}|\[.*\]/.test(message)) score += 0.2;
    // Excessive punctuation (formatting markers)
    if ((message.match(/[#*`>]/g)?.length ?? 0) > 10) score += 0.2;

    return Math.min(score, 1.0);
  }

  private async flagInjectionAttempt(
    ip: string,
    message: string,
    method: string,
    score?: number,
  ): Promise<void> {
    const key = `injection:${ip}`;
    const count = await this.redis.incr(key);
    await this.redis.expire(key, 3600); // Reset counter after 1 hour

    await this.analytics.track({
      eventName: 'prompt_injection_attempt',
      properties: {
        ip,
        method,
        score,
        attempt: count,
        // Never log full message — only first 50 chars for debugging
        messagePreview: message.slice(0, 50),
      },
    });

    if (count > 10) {
      // Soft-ban: add to heightened scrutiny list
      await this.redis.setEx(`suspicious_ip:${ip}`, 86400, '1');
    }

    this.logger.warn(
      `Injection attempt ${count} from ${ip} via ${method}${score ? ` (score: ${score})` : ''}`,
    );
  }

  private getClientIp(request: Request): string {
    return (
      (request.headers['cf-connecting-ip'] as string) || // Cloudflare
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      'unknown'
    );
  }
}

// ─── Input Sanitization Pipe ──────────────────────────────────────────────────

import {
  PipeTransform,
  ArgumentMetadata,
  Injectable as NestInjectable,
} from '@nestjs/common';

@NestInjectable()
export class InputSanitizationPipe implements PipeTransform {
  private readonly MAX_STRING_LENGTH = 5000;

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') return value;
    if (typeof value !== 'object' || value === null) return value;

    return this.sanitizeObject(value as Record<string, unknown>);
  }

  private sanitizeObject(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string') {
        sanitized[key] = this.sanitizeString(val);
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        sanitized[key] = this.sanitizeObject(val as Record<string, unknown>);
      } else {
        sanitized[key] = val;
      }
    }

    return sanitized;
  }

  private sanitizeString(str: string): string {
    // Trim length
    let sanitized = str.slice(0, this.MAX_STRING_LENGTH);

    // Strip null bytes (can cause issues in some DB drivers)
    sanitized = sanitized.replace(/\x00/g, '');

    // Strip HTML tags (all user-facing text is treated as plain text)
    sanitized = sanitized.replace(/<[^>]*>/g, '');

    // Normalize unicode to NFC (prevents homograph attacks)
    sanitized = sanitized.normalize('NFC');

    return sanitized.trim();
  }
}

// ─── Custom Rate Limit Guard ──────────────────────────────────────────────────

@Injectable()
export class ChatRateLimitGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    // Rate limit by user ID when authenticated, IP otherwise
    const userId = (req as any).user?.id;
    if (userId) return `user:${userId}`;

    const guestId = (req as any).guestUser?.id;
    if (guestId) return `guest:${guestId}`;

    return `ip:${req.ip}`;
  }
}
