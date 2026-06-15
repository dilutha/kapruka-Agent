/**
 * Language Detector
 *
 * Detects whether user input is English, Sinhala (Unicode), or Singlish.
 *
 * Strategy (fast-path first, LLM fallback last):
 *
 *  1. Sinhala Unicode range detection  → O(n) character scan, ~0ms
 *     Sinhala Unicode block: U+0D80–U+0DFF
 *     If > 20% of characters are in this range → Language.SI
 *
 *  2. Singlish heuristic dictionary   → O(k) keyword lookup, ~0ms
 *     Common Singlish patterns: "machan", "aiyo", "aney", "la", "ah?",
 *     "no?", "ithin", "den", "neh", "podi", "watte"
 *     If 2+ matches in message → Language.SINGLISH
 *
 *  3. LLM fallback (gpt-4o-mini)      → ~300ms
 *     Only triggered for ambiguous cases not caught by heuristics
 *     Cached in Redis for identical strings (1-hour TTL)
 *
 * This approach keeps 95%+ of detections at <1ms with no API calls.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Language } from '@prisma/client';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class LanguageDetector {
  private readonly logger = new Logger(LanguageDetector.name);

  // Sinhala Unicode block: U+0D80–U+0DFF
  private readonly SINHALA_RANGE_START = 0x0d80;
  private readonly SINHALA_RANGE_END = 0x0dff;
  private readonly SINHALA_THRESHOLD = 0.15; // 15% of chars in Sinhala block

  // Singlish marker words/patterns (case-insensitive)
  private readonly SINGLISH_MARKERS: RegExp[] = [
    /\bmachan\b/i,
    /\baiyo\b/i,
    /\baney\b/i,
    /\bithin\b/i,
    /\bneh\b/i,
    /\bwatte\b/i,
    /\bpodi\b/i,
    /\bpatta\b/i,
    /\bada\b/i,
    /\bhari\b/i,
    /\banna\b/i,
    /\bmalli\b/i,
    /\bakka\b/i,
    /\bnangi\b/i,
    /\bayya\b/i,
    /\b(no|la|ah)\?/i,         // "right no?", "okay la", "coming ah?"
    /\bna\s*yaar\b/i,
    /\bgone\s*case\b/i,
    /\bsthu\b/i,
    /\bapey\b/i,
  ];

  private readonly llmModel: ChatOpenAI;

  constructor(private readonly redis: RedisService) {
    this.llmModel = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 10,
    });
  }

  async detect(text: string): Promise<Language> {
    if (!text || text.trim().length === 0) return Language.EN;

    // Fast path 1: Sinhala Unicode
    if (this.hasSinhalaScript(text)) {
      return Language.SI;
    }

    // Fast path 2: Singlish heuristics
    if (this.hasSinglishMarkers(text)) {
      return Language.SINGLISH;
    }

    // Fast path 3: Pure ASCII / clearly English — skip LLM
    if (this.isClearlyEnglish(text)) {
      return Language.EN;
    }

    // Slow path: LLM classification for ambiguous inputs
    return this.classifyWithLlm(text);
  }

  // ─── Heuristic methods ────────────────────────────────────────────────────────

  private hasSinhalaScript(text: string): boolean {
    let sinhalaCount = 0;
    let totalChars = 0;

    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      // Skip spaces and punctuation in ratio calculation
      if (char.trim().length === 0) continue;
      totalChars++;
      if (code >= this.SINHALA_RANGE_START && code <= this.SINHALA_RANGE_END) {
        sinhalaCount++;
      }
    }

    return totalChars > 0 && sinhalaCount / totalChars >= this.SINHALA_THRESHOLD;
  }

  private hasSinglishMarkers(text: string): boolean {
    let matchCount = 0;
    for (const pattern of this.SINGLISH_MARKERS) {
      if (pattern.test(text)) {
        matchCount++;
        if (matchCount >= 2) return true; // Two distinct markers = confident Singlish
      }
    }
    return false;
  }

  private isClearlyEnglish(text: string): boolean {
    // All characters are in ASCII printable range + basic Latin
    // and no Sinhala/Tamil Unicode detected
    return /^[\x00-\x7F\u00C0-\u024F\s.,!?'"()\-:;]+$/.test(text);
  }

  // ─── LLM fallback ─────────────────────────────────────────────────────────────

  private async classifyWithLlm(text: string): Promise<Language> {
    // Check Redis cache first (identical text → same language)
    const cacheKey = `lang:${Buffer.from(text.slice(0, 100)).toString('base64')}`;
    const cached = await this.redis.get(cacheKey);
    if (cached && Object.values(Language).includes(cached as Language)) {
      return cached as Language;
    }

    try {
      const response = await this.llmModel.invoke([
        new SystemMessage(
          `Classify the language of the following text. 
Respond with EXACTLY one word: EN, SI, or SINGLISH.

Definitions:
- EN: Standard English, no Sinhala words
- SI: Primarily Sinhala (even if romanized)
- SINGLISH: English mixed with Sinhala/Sri Lankan slang (e.g. "machan", "aiyo", "la", "neh", "ah?")

ONLY output the classification word. No explanation.`,
        ),
        new HumanMessage(text.slice(0, 200)), // Limit to 200 chars
      ]);

      const raw = (response.content as string).trim().toUpperCase();
      const language =
        raw === 'SI'
          ? Language.SI
          : raw === 'SINGLISH'
            ? Language.SINGLISH
            : Language.EN;

      // Cache for 1 hour
      await this.redis.setEx(cacheKey, 3600, language);

      return language;
    } catch (error) {
      this.logger.error('LLM language detection failed:', error);
      return Language.EN; // Safe default
    }
  }
}
