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
 *  3. Gemini fallback                 → network-bound
 *     Only triggered for ambiguous cases not caught by heuristics
 *     Cached in Redis for identical strings (1-hour TTL)
 *
 * This approach keeps 95%+ of detections at <1ms with no API calls.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Language } from '@prisma/client';
import { RedisService } from '../../redis/redis.service';
import { GeminiService } from '../gemini/gemini.service';

@Injectable()
export class LanguageDetector {
  private readonly logger = new Logger(LanguageDetector.name);

  // Sinhala Unicode block: U+0D80–U+0DFF
  private readonly SINHALA_RANGE_START = 0x0d80;
  private readonly SINHALA_RANGE_END = 0x0dff;
  private readonly SINHALA_THRESHOLD = 0.15; // 15% of chars in Sinhala block

  // Singlish marker words/patterns (case-insensitive), split by how
  // unambiguous they are. "machan"/"aiyo"/etc. never occur in standard
  // English, so ONE match is enough to call it — this matters concretely:
  // "hii machan" has exactly one marker, and requiring 2+ (as this used to,
  // uniformly) meant it fell through to the ASCII-only "clearly English"
  // fast path and got detected as EN, not SINGLISH. Ambiguous tokens that
  // double as English names/words ("Hari", "Anna", "no?" as a tag question)
  // stay in the weak tier, needing 2+ co-occurrences to fire — a single
  // "Anna" must not flip a genuinely English sentence to Singlish.
  private readonly SINGLISH_STRONG_MARKERS: RegExp[] = [
    /\bmachan\b/i,
    /\baiyo\b/i,
    /\baney\b/i,
    /\bithin\b/i,
    /\bwatte\b/i,
    /\bpodi\b/i,
    /\bpatta\b/i,
    /\bmalli\b/i,
    /\bnangi\b/i,
    /\bayya\b/i,
    /\bna\s*yaar\b/i,
    /\bgone\s*case\b/i,
    /\bsthu\b/i,
    /\bapey\b/i,
  ];

  private readonly SINGLISH_WEAK_MARKERS: RegExp[] = [
    /\bneh\b/i,
    /\bada\b/i,
    /\bhari\b/i,
    /\banna\b/i,
    /\bakka\b/i,
    /\b(no|la|ah)\?/i, // "right no?", "okay la", "coming ah?"
  ];

  constructor(
    private readonly redis: RedisService,
    private readonly gemini: GeminiService,
  ) {}

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

    return (
      totalChars > 0 && sinhalaCount / totalChars >= this.SINHALA_THRESHOLD
    );
  }

  private hasSinglishMarkers(text: string): boolean {
    if (this.SINGLISH_STRONG_MARKERS.some((pattern) => pattern.test(text))) {
      return true;
    }

    let weakMatchCount = 0;
    for (const pattern of this.SINGLISH_WEAK_MARKERS) {
      if (pattern.test(text)) {
        weakMatchCount++;
        if (weakMatchCount >= 2) return true; // Two ambiguous markers = confident enough
      }
    }
    return false;
  }

  private isClearlyEnglish(text: string): boolean {
    // All characters are in ASCII printable range + basic Latin
    // and no Sinhala/Tamil Unicode detected.
    // The \x00-\x1F control range is deliberate: this is a whole-string
    // whitelist, and excluding control characters here would misclassify
    // otherwise-English text that merely contains a stray \t or \r.
    // eslint-disable-next-line no-control-regex
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
      const response = await this.gemini.generateText({
        systemInstruction: `Classify the language of the following text. 
Respond with EXACTLY one word: EN, SI, or SINGLISH.

Definitions:
- EN: Standard English, no Sinhala words
- SI: Primarily Sinhala (even if romanized)
- SINGLISH: English mixed with Sinhala/Sri Lankan slang (e.g. "machan", "aiyo", "la", "neh", "ah?")

ONLY output the classification word. No explanation.`,
        messages: [{ role: 'user', text: text.slice(0, 200) }],
        temperature: 0,
        maxOutputTokens: 10,
      });

      const raw = response.trim().toUpperCase();
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
