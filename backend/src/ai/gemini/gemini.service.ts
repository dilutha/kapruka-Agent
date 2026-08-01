import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FinishReason,
  FunctionCall,
  FunctionDeclaration,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  Schema,
  ThinkingLevel,
  Type,
} from '@google/genai';
import { z } from 'zod';

export interface GeminiMessage {
  role: 'user' | 'model';
  text: string;
}

export interface GeminiGenerateTextParams {
  systemInstruction: string;
  messages: GeminiMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  tools?: FunctionDeclaration[];
}

export interface GeminiGenerateJsonParams<T> {
  systemInstruction: string;
  prompt: string;
  schema: Schema;
  validator: z.ZodType<T>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GeminiToolCallResult {
  text: string;
  functionCalls: FunctionCall[];
}

/**
 * Thrown specifically for 429 RESOURCE_EXHAUSTED. Distinct from the base
 * `ServiceUnavailableException` so callers (chat.service.ts) can forward its
 * message verbatim — it's already a safe, user-facing "try again in N
 * seconds" string — while every *other* failure still collapses to a
 * generic message rather than leaking internal detail to the end user.
 */
export class GeminiQuotaExceededException extends ServiceUnavailableException {}

@Injectable()
export class GeminiService {
  // A quota RetryInfo delay at or under this is worth waiting out inline;
  // beyond it we fail fast rather than hold a live chat request open —
  // free-tier per-day quota resets commonly report multi-minute delays.
  private static readonly MAX_INLINE_QUOTA_WAIT_MS = 10_000;

  // When a response is cut off by MAX_TOKENS, we retry with a bigger budget
  // rather than immediately failing — but bounded, so a pathological prompt
  // can't spiral into an ever-growing token bill. Each escalation is a full
  // extra generateContent() round trip (itself retried up to maxRetries
  // times on transient failures), so this is a direct multiplier on
  // worst-case latency: with thinkingLevel LOW measured at 0 thought tokens
  // in testing, MAX_TOKENS should now be rare, so 1 escalation is enough
  // headroom for a genuine edge case without doubling the tail for a rare
  // event (was 2 — compounding with maxRetries made a single logical call
  // capable of up to 3×3=9 real network round trips).
  private static readonly MAX_BUDGET_ESCALATIONS = 1;
  private static readonly MAX_OUTPUT_TOKEN_CAP = 4096;

  private readonly logger = new Logger(GeminiService.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ai.geminiApiKey');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiService');
    }

    this.client = new GoogleGenAI({ apiKey });
    this.model = this.config.get<string>('ai.geminiModel', 'gemini-3.6-flash');
    this.timeoutMs = this.config.get<number>('ai.geminiTimeoutMs', 20_000);
    this.maxRetries = this.config.get<number>('ai.geminiMaxRetries', 3);
  }

  async generateText(params: GeminiGenerateTextParams): Promise<string> {
    const startedAt = Date.now();
    try {
      return await this.generateTextInternal(params);
    } finally {
      this.logger.debug(`generateText took ${Date.now() - startedAt}ms`);
    }
  }

  private async generateTextInternal(
    params: GeminiGenerateTextParams,
  ): Promise<string> {
    let maxOutputTokens = params.maxOutputTokens ?? 1024;
    let response: GenerateContentResponse | undefined;

    for (
      let escalation = 0;
      escalation <= GeminiService.MAX_BUDGET_ESCALATIONS;
      escalation++
    ) {
      response = await this.withRetry(async (abortSignal) => {
        return this.client.models.generateContent({
          model: this.model,
          contents: this.toContents(params.messages),
          config: this.buildConfig(params, abortSignal, maxOutputTokens),
        });
      });

      const text = response.text?.trim();
      // Non-empty output is usable even if MAX_TOKENS cut it off mid-sentence
      // — a slightly truncated chat reply is still useful, and re-requesting
      // purely for cosmetic completeness burns quota for little benefit.
      if (text) return text;

      if (
        !this.isMaxTokensCutoff(response) ||
        escalation === GeminiService.MAX_BUDGET_ESCALATIONS
      ) {
        break;
      }

      maxOutputTokens = Math.min(
        maxOutputTokens * 2,
        GeminiService.MAX_OUTPUT_TOKEN_CAP,
      );
      this.logger.warn(
        `Gemini hit MAX_TOKENS with empty text; retrying with maxOutputTokens=${maxOutputTokens} (escalation ${escalation + 1}/${GeminiService.MAX_BUDGET_ESCALATIONS}).`,
      );
    }

    this.logger.warn(
      `Gemini returned an empty text response. ${this.describeEmptyResponse(response!)}`,
    );
    throw new ServiceUnavailableException('AI response was empty');
  }

  async generateTextWithTools(
    params: GeminiGenerateTextParams,
  ): Promise<GeminiToolCallResult> {
    const response = await this.withRetry(async (abortSignal) => {
      return this.client.models.generateContent({
        model: this.model,
        contents: this.toContents(params.messages),
        config: this.buildConfig(params, abortSignal),
      });
    });

    return {
      text: response.text?.trim() ?? '',
      functionCalls: response.functionCalls ?? [],
    };
  }

  async *streamText(params: GeminiGenerateTextParams): AsyncGenerator<string> {
    const stream = await this.withRetry(async (abortSignal) => {
      return this.client.models.generateContentStream({
        model: this.model,
        contents: this.toContents(params.messages),
        config: this.buildConfig(params, abortSignal),
      });
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        yield text;
      }
    }
  }

  async generateJson<T>(params: GeminiGenerateJsonParams<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await this.generateJsonInternal(params);
    } finally {
      this.logger.debug(`generateJson took ${Date.now() - startedAt}ms`);
    }
  }

  private async generateJsonInternal<T>(
    params: GeminiGenerateJsonParams<T>,
  ): Promise<T> {
    let maxOutputTokens = params.maxOutputTokens ?? 512;
    let response: GenerateContentResponse | undefined;

    for (
      let escalation = 0;
      escalation <= GeminiService.MAX_BUDGET_ESCALATIONS;
      escalation++
    ) {
      response = await this.withRetry(async (abortSignal) => {
        return this.client.models.generateContent({
          model: this.model,
          contents: params.prompt,
          config: {
            abortSignal,
            systemInstruction: params.systemInstruction,
            temperature: params.temperature ?? 0,
            maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: params.schema,
            // See buildConfig() for why thinking is minimized — with it at
            // its default level, this model can spend the entire
            // maxOutputTokens budget on hidden "thought" tokens before
            // emitting any of the JSON itself, which is exactly what
            // produced "Gemini JSON response was not parseable" (a
            // MAX_TOKENS cutoff mid-object) and "empty text" alike.
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
      });

      // Unlike generateText(), a partial/truncated JSON body is never
      // usable — retry with a bigger budget purely on the finishReason
      // signal, whether or not `.text` happens to already look non-empty.
      if (
        !this.isMaxTokensCutoff(response) ||
        escalation === GeminiService.MAX_BUDGET_ESCALATIONS
      ) {
        break;
      }

      maxOutputTokens = Math.min(
        maxOutputTokens * 2,
        GeminiService.MAX_OUTPUT_TOKEN_CAP,
      );
      this.logger.warn(
        `Gemini JSON response hit MAX_TOKENS; retrying with maxOutputTokens=${maxOutputTokens} (escalation ${escalation + 1}/${GeminiService.MAX_BUDGET_ESCALATIONS}).`,
      );
    }

    const finalResponse = response!;
    const text = finalResponse.text;

    if (!text) {
      this.logger.warn(
        `Gemini returned empty JSON. ${this.describeEmptyResponse(finalResponse)}`,
      );
      throw new ServiceUnavailableException('Gemini returned empty JSON');
    }

    const parsed = this.parseJson(text, finalResponse);
    return params.validator.parse(parsed);
  }

  createIntentSchema(): Schema {
    return {
      type: Type.OBJECT,
      required: ['intent', 'confidence'],
      properties: {
        intent: {
          type: Type.STRING,
          format: 'enum',
          enum: [
            'SEARCH',
            'RECOMMEND',
            'CHECKOUT',
            'ADD_TO_CART',
            'REMOVE_FROM_CART',
            'TRACK',
            'GIFT',
            'LANGUAGE_SWITCH',
            'CHITCHAT',
          ],
        },
        confidence: {
          type: Type.NUMBER,
          minimum: 0,
          maximum: 1,
        },
        extracted: {
          type: Type.OBJECT,
          nullable: true,
          properties: {
            query: { type: Type.STRING, nullable: true },
            orderId: { type: Type.STRING, nullable: true },
            occasion: { type: Type.STRING, nullable: true },
            budget: { type: Type.NUMBER, nullable: true },
            language: {
              type: Type.STRING,
              format: 'enum',
              enum: ['EN', 'SI', 'SINGLISH'],
              nullable: true,
            },
          },
        },
      },
      propertyOrdering: ['intent', 'confidence', 'extracted'],
    };
  }

  /**
   * Drives `checkout.node.ts`'s single-call-per-turn field extraction —
   * mirrors `createIntentSchema()`'s `nullable: true` pattern for the same
   * reason (structured-output mode always fills every property; a field
   * that doesn't apply comes back as JSON `null`, never an omitted key).
   */
  createCheckoutExtractionSchema(): Schema {
    return {
      type: Type.OBJECT,
      required: ['confirms', 'cancels', 'responseText'],
      properties: {
        extracted: {
          type: Type.OBJECT,
          nullable: true,
          properties: {
            recipientName: { type: Type.STRING, nullable: true },
            phone: { type: Type.STRING, nullable: true },
            addressLine1: { type: Type.STRING, nullable: true },
            city: { type: Type.STRING, nullable: true },
            deliveryDate: { type: Type.STRING, nullable: true },
            wantsGiftMessage: { type: Type.BOOLEAN, nullable: true },
            giftFromName: { type: Type.STRING, nullable: true },
            giftMessageText: { type: Type.STRING, nullable: true },
            giftAnonymous: { type: Type.BOOLEAN, nullable: true },
          },
        },
        confirms: { type: Type.BOOLEAN },
        cancels: { type: Type.BOOLEAN },
        responseText: { type: Type.STRING },
      },
      propertyOrdering: ['extracted', 'confirms', 'cancels', 'responseText'],
    };
  }

  private buildConfig(
    params: GeminiGenerateTextParams,
    abortSignal: AbortSignal,
    maxOutputTokens: number = params.maxOutputTokens ?? 1024,
  ): GenerateContentConfig {
    return {
      abortSignal,
      systemInstruction: params.systemInstruction,
      temperature: params.temperature ?? 0.4,
      maxOutputTokens,
      tools: params.tools?.length
        ? [{ functionDeclarations: params.tools }]
        : undefined,
      // this.model ("gemini-3.6-flash") is a mandatory-reasoning model that,
      // left at its default thinking level, spends a variable and sometimes
      // large share of maxOutputTokens on hidden "thought" tokens before
      // emitting any visible text (observed 90-320 thought tokens for a
      // one-line chitchat reply during investigation, against budgets as
      // low as 300-700). When thinking consumes the whole budget, the
      // response hits MAX_TOKENS with zero visible text — that was the
      // entire cause of "Gemini returned an empty text response".
      //
      // `thinkingBudget: 0` is rejected outright for this model (400
      // INVALID_ARGUMENT — 0 is outside its allowed range; unlike some
      // Gemini models, thinking can't be fully disabled here). `LOW` is the
      // minimum this model accepts, and measured at 0 thought tokens in
      // testing — these call sites are bounded classification/grounding/
      // chitchat tasks that don't need deep reasoning, so minimizing
      // thinking makes maxOutputTokens map back to visible output.
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    };
  }

  /**
   * Renders the parts of a raw Gemini response that explain *why* no usable
   * text came back — finish reason, candidate/safety details, and token
   * accounting — so a truncated or filtered response is diagnosable from the
   * log alone instead of requiring a re-run with a debugger attached.
   */
  private describeEmptyResponse(response: GenerateContentResponse): string {
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason ?? 'unknown';
    const partsSummary =
      candidate?.content?.parts
        ?.map((p) => Object.keys(p).join('+'))
        .join(', ') ?? '(no parts)';
    const usage = response.usageMetadata;

    return (
      `finishReason=${finishReason}, parts=[${partsSummary}], ` +
      `promptFeedback=${JSON.stringify(response.promptFeedback ?? null)}, ` +
      `usage=${JSON.stringify(usage ?? null)}`
    );
  }

  /** True when the model stopped because it ran out of output budget. */
  private isMaxTokensCutoff(response: GenerateContentResponse): boolean {
    return response.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS;
  }

  private toContents(messages: GeminiMessage[]) {
    return messages.map((message) => ({
      role: message.role,
      parts: [{ text: message.text }],
    }));
  }

  private async withRetry<T>(
    operation: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        return await operation(controller.signal);
      } catch (error) {
        lastError = error;

        const authProblem = this.describeAuthError(error);
        if (authProblem) {
          // Never retryable — an invalid credential/project fails identically
          // every time, so retrying only delays the (still generic) 503.
          this.logger.error(authProblem);
          throw new ServiceUnavailableException(
            'AI provider rejected the request due to a server-side configuration problem. Check GEMINI_API_KEY.',
          );
        }

        const quotaProblem = this.describeQuotaError(error);
        if (quotaProblem) {
          const { retryDelayMs } = quotaProblem;
          const canWaitInline =
            attempt < this.maxRetries &&
            retryDelayMs !== null &&
            retryDelayMs <= GeminiService.MAX_INLINE_QUOTA_WAIT_MS;

          if (canWaitInline) {
            // Google told us exactly how long its quota window needs —
            // honor that instead of our own (much shorter) exponential
            // backoff, which would just re-hit the same exhausted quota.
            this.logger.warn(
              `${quotaProblem.message} Waiting ${retryDelayMs}ms (Google-directed) before retrying (attempt ${attempt}/${this.maxRetries}).`,
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            continue;
          }

          // No usable RetryInfo, or the wait is too long to hold a live chat
          // request open for (free-tier per-day quotas commonly return
          // multi-minute or multi-hour delays) — fail fast with a message
          // that tells the user when it's actually worth trying again,
          // instead of either retrying blindly or a generic 503.
          this.logger.error(quotaProblem.message);
          throw new GeminiQuotaExceededException(
            `The assistant has reached its current usage limit. Please try again in ${this.formatWaitTime(retryDelayMs)}.`,
          );
        }

        if (!this.isRetryable(error) || attempt === this.maxRetries) {
          break;
        }

        const delayMs = this.backoffMs(attempt);
        this.logger.warn(
          `Gemini request failed; retrying in ${delayMs}ms (attempt ${attempt}/${this.maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } finally {
        clearTimeout(timeout);
      }
    }

    this.logger.error('Gemini request failed after retries', lastError);
    throw new ServiceUnavailableException('AI provider unavailable');
  }

  /**
   * Returns a detailed, actionable diagnostic for auth/permission failures
   * (401/403), or `null` for anything else. These status codes mean the
   * request never reached model inference — retrying is pointless and the
   * generic "AI provider unavailable" message hides exactly the information
   * an operator needs (which credential, which project, why).
   */
  private describeAuthError(error: unknown): string | null {
    const status = this.extractStatus(error);
    if (status !== 401 && status !== 403) return null;

    const raw = error instanceof Error ? error.message : String(error);

    if (status === 401) {
      return (
        `Gemini API rejected credentials (401 UNAUTHENTICATED). ` +
        `GEMINI_API_KEY is missing, malformed, or revoked. Raw: ${raw}`
      );
    }

    return (
      `Gemini API denied access (403 PERMISSION_DENIED) for model "${this.model}". ` +
      'This is a configuration problem, not a transient outage: the Google ' +
      'Cloud project behind GEMINI_API_KEY does not have the Generative ' +
      'Language API enabled for this key, or the key was issued for a ' +
      'different Google product (e.g. a Vertex AI service-account token) ' +
      'and was never a direct Gemini API key to begin with. Generate a key ' +
      `at https://aistudio.google.com/apikey. Raw: ${raw}`
    );
  }

  /**
   * Returns a diagnostic + parsed `RetryInfo` for a 429 RESOURCE_EXHAUSTED
   * response, or `null` for anything else. 429 is handled separately from
   * `isRetryable()`'s generic backoff: Google tells us exactly how long its
   * quota window needs via a structured `RetryInfo.retryDelay` in the error
   * body, and honoring that (instead of guessing with our own short
   * exponential backoff) is the whole point of this method.
   */
  private describeQuotaError(
    error: unknown,
  ): { message: string; retryDelayMs: number | null } | null {
    const status = this.extractStatus(error);
    if (status !== 429) return null;

    const retryDelayMs = this.extractRetryDelayMs(error);
    const raw = error instanceof Error ? error.message : String(error);

    return {
      retryDelayMs,
      message:
        `Gemini API quota exceeded (429 RESOURCE_EXHAUSTED). Expected on the ` +
        `free tier once its request quota is used up for the current ` +
        `window${retryDelayMs !== null ? ` — Google's RetryInfo says wait ${retryDelayMs}ms` : ' (no RetryInfo in the response)'}. ` +
        `Raw: ${raw}`,
    };
  }

  /**
   * Parses the `google.rpc.RetryInfo` detail Google attaches to quota-error
   * bodies (`{"error":{"details":[{"@type":".../RetryInfo","retryDelay":"13s"}]}}`).
   * `ApiError.message` is the raw JSON-stringified error body (see
   * `throwErrorIfNotOK` in the SDK), so it's parsed back out here rather than
   * guessed at. Returns `null` if the error isn't JSON or carries no
   * RetryInfo — callers must treat that as "unknown wait time", not zero.
   */
  private extractRetryDelayMs(error: unknown): number | null {
    const raw = error instanceof Error ? error.message : undefined;
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    const details = (parsed as { error?: { details?: unknown } })?.error
      ?.details;
    if (!Array.isArray(details)) return null;

    const retryInfo = details.find(
      (detail): detail is { retryDelay: string } =>
        typeof detail === 'object' &&
        detail !== null &&
        typeof (detail as { ['@type']?: unknown })['@type'] === 'string' &&
        (detail as { ['@type']: string })['@type'].endsWith('RetryInfo') &&
        typeof (detail as { retryDelay?: unknown }).retryDelay === 'string',
    );
    if (!retryInfo) return null;

    // Protobuf Duration string format: e.g. "13s", "1.500s".
    const match = /^([\d.]+)s$/.exec(retryInfo.retryDelay);
    if (!match) return null;

    return Math.round(parseFloat(match[1]) * 1000);
  }

  private formatWaitTime(ms: number | null): string {
    if (ms === null) return 'a short while';

    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;

    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }

    // 429 is handled by describeQuotaError() before this is ever reached.
    const status = this.extractStatus(error);
    return status === 408 || (status >= 500 && status < 600);
  }

  private extractStatus(error: unknown): number {
    if (typeof error !== 'object' || error === null) return 0;

    const maybeStatus = 'status' in error ? error.status : undefined;
    if (typeof maybeStatus === 'number') return maybeStatus;

    const maybeCode = 'code' in error ? error.code : undefined;
    if (typeof maybeCode === 'number') return maybeCode;

    return 0;
  }

  private backoffMs(attempt: number): number {
    const base = 300 * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 150);
    return base + jitter;
  }

  /**
   * `responseMimeType: 'application/json'` + `responseSchema` already ask
   * the API for a bare JSON body, so a well-formed response never carries
   * Markdown fences. This still strips a leading/trailing ```json ... ```
   * (or plain ```) wrapper defensively — some responses echo the fence
   * anyway — before falling back to brace-matching for a response that's
   * merely surrounded by prose.
   */
  private parseJson(text: string, response: GenerateContentResponse): unknown {
    const unfenced = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    try {
      return JSON.parse(unfenced);
    } catch {
      // Well-formed but wrapped in prose the model added anyway.
      const match = unfenced.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          // Fall through to repair — a MAX_TOKENS cutoff mid-object still
          // starts with a real "{...", it just never got the chance to close.
        }
      }

      const repaired = this.tryRepairTruncatedJson(match?.[0] ?? unfenced);
      if (repaired !== null) {
        this.logger.warn(
          `Gemini JSON response was truncated but recoverable. ${this.describeEmptyResponse(response)}`,
        );
        return repaired;
      }

      this.logger.warn(
        `Gemini JSON response was not parseable. ${this.describeEmptyResponse(response)}. ` +
          `Raw text: ${JSON.stringify(text.slice(0, 500))}`,
      );
      throw new Error('Gemini JSON response was not parseable');
    }
  }

  /**
   * Best-effort recovery for JSON truncated mid-object by a MAX_TOKENS
   * cutoff — the common failure shape is a dangling open string and/or one
   * or more unclosed `{`/`[`. Closes a dangling string, drops a trailing
   * comma, and appends the brackets/braces needed to balance what's already
   * there. This can't recover data that was never emitted (a field cut off
   * before its value), only make the *shape* valid — `validator.parse()`
   * downstream still rejects anything a required field is missing from.
   * Returns `null` (never partial garbage) if the result still isn't valid
   * JSON.
   */
  private tryRepairTruncatedJson(text: string): unknown {
    let repaired = text.trim();
    if (!repaired.startsWith('{') && !repaired.startsWith('[')) return null;

    const unescapedQuotes = (repaired.match(/(?<!\\)"/g) ?? []).length;
    if (unescapedQuotes % 2 !== 0) repaired += '"';

    repaired = repaired.replace(/,\s*$/, '');

    const opens = (repaired.match(/[{[]/g) ?? []).length;
    const closes = (repaired.match(/[}\]]/g) ?? []).length;
    const openBraces = (repaired.match(/{/g) ?? []).length;
    const closeBraces = (repaired.match(/}/g) ?? []).length;
    const openBrackets = (repaired.match(/\[/g) ?? []).length;
    const closeBrackets = (repaired.match(/]/g) ?? []).length;
    if (opens <= closes) return null; // nothing to repair, or unbalanced the other way

    repaired += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
    repaired += '}'.repeat(Math.max(0, openBraces - closeBraces));

    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}
