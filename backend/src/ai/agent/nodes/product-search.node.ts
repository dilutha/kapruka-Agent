/**
 * Product Search Node
 *
 * Handles SEARCH and related intents.
 * Flow:
 *  1. Build search parameters from state (query, filters, language)
 *  2. Call Kapruka MCP searchProducts tool
 *  3. Cache results in ProductCache table for 30 minutes
 *  4. Stream a grounded natural-language response
 *
 * Hallucination prevention:
 *  - Response generation only starts AFTER tool results are in state
 *  - System prompt explicitly forbids inventing products
 *  - Product data is injected into context as structured JSON, not plain text
 */

import { Injectable, Logger } from '@nestjs/common';

import { AgentState } from '../agent-orchestrator';
import { McpClientService } from '../../../mcp/mcp-client.service';
import { PromptLibrary } from '../prompts/prompt-library';
import { ProductCacheRepository } from '../../../modules/product/repositories/product-cache.repository';
import { Language } from '@prisma/client';
import { GeminiService } from '../../gemini/gemini.service';

@Injectable()
export class ProductSearchNode {
  private readonly logger = new Logger(ProductSearchNode.name);

  constructor(
    private readonly mcpClient: McpClientService,
    private readonly prompts: PromptLibrary,
    private readonly productCache: ProductCacheRepository,
    private readonly gemini: GeminiService,
  ) {}

  // Purely referential follow-ups — "show cheaper ones", "any cheaper
  // options" — never restate the product themselves. `searchQuery` still
  // resolves them (it's seeded from the previous turn's persisted context
  // whenever the classifier extracted nothing new this turn — see
  // AgentOrchestrator.streamMessage), but a plain re-run of the same search
  // would ignore what the user actually asked for. Detecting these keywords
  // in the raw message and turning them into real min/max price filters is
  // what makes "cheaper ones" actually narrow the results.
  private static readonly CHEAPER_PATTERN =
    /\b(cheap(er)?|less expensive|budget|affordable|lower price)\b/i;
  private static readonly PREMIUM_PATTERN =
    /\b(premium|expensive|luxury|higher end|top range|pricier)\b/i;

  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    const { searchQuery, language } = state;

    if (!searchQuery) {
      return {
        response: this.getNoQueryMessage(language),
        responseType: 'text',
      };
    }

    const rawMessage = this.lastHumanMessageText(state);
    const wantsCheaper = ProductSearchNode.CHEAPER_PATTERN.test(rawMessage);
    const wantsPremium = ProductSearchNode.PREMIUM_PATTERN.test(rawMessage);
    const priceFilterActive = wantsCheaper || wantsPremium;

    // A prior stated budget anchors "cheaper" to something concrete (30%
    // under it); with no prior budget, fall back to a broad ceiling/floor
    // that still meaningfully separates "cheap" from "premium" results.
    const maxPrice = wantsCheaper
      ? Math.round((state.budget ?? 6000) * 0.7)
      : undefined;
    const minPrice = wantsPremium ? (state.budget ?? 5000) : undefined;

    this.logger.log(
      `Product search: "${searchQuery}" [${language}]${priceFilterActive ? ` (price filter: ${wantsCheaper ? `<=${maxPrice}` : `>=${minPrice}`})` : ''}`,
    );

    // A price-filtered request must hit MCP with that filter applied — the
    // product cache has no price dimension, so a cache hit here would
    // silently ignore "cheaper" and just return the same results as before.
    const cached = priceFilterActive
      ? null
      : await this.productCache.findByQuery(searchQuery);

    let searchResults;
    if (cached && cached.length > 0) {
      this.logger.debug(`Cache HIT for query: ${searchQuery}`);
      searchResults = cached;
    } else {
      // Step 2: Call Kapruka MCP
      try {
        const mcpResult = await this.mcpClient.searchProducts({
          query: searchQuery,
          language: language === Language.SI ? 'si' : 'en',
          limit: 8,
          maxPrice,
          minPrice,
        });
        searchResults = mcpResult.products;

        // Step 3: Cache results (price-filtered results aren't cached under
        // the plain query key — they'd wrongly satisfy a future unfiltered
        // search for the same term).
        if (searchResults.length > 0 && !priceFilterActive) {
          await this.productCache.upsertMany(searchResults);
        }
      } catch (err) {
        this.logger.error('MCP searchProducts failed:', err);
        return {
          response: this.getMcpErrorMessage(language),
          responseType: 'text',
          lastError: {
            code: 'MCP_SEARCH_FAILED',
            message: 'Kapruka catalog unavailable',
            isRetryable: true,
          },
        };
      }
    }

    const groundedContext = JSON.stringify({
      query: searchQuery,
      count: searchResults.length,
      products: searchResults.map((p) => ({
        id: p.id,
        name: p.name,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        currency: p.currency,
        category: p.category,
        imageUrls: p.imageUrls,
        isAvailable: p.isAvailable,
      })),
    });

    const response = await this.gemini.generateText({
      systemInstruction: this.prompts.getProductSearchPrompt(language),
      messages: [
        {
          role: 'user',
          text: `User search query: ${searchQuery}\n\nKapruka MCP searchProducts result JSON:\n${groundedContext}`,
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 350,
    });

    return {
      searchResults,
      response,
      responseType: 'product_list',
      toolResults: [
        {
          toolName: 'searchProducts',
          result: searchResults,
          timestamp: Date.now(),
        },
      ],
    };
  }

  private getNoQueryMessage(language: Language): string {
    const messages: Record<Language, string> = {
      [Language.EN]:
        "What are you looking for? Tell me a product name, category, or occasion and I'll search Kapruka for you.",
      [Language.SI]:
        'ඔබ සොයන දෙය කුමක්ද? නිෂ්පාදනයේ නමක් හෝ ප්‍රවර්ගයක් ලබා දෙන්න.',
      [Language.SINGLISH]:
        "What you want to find machan? Tell me product name or category, I'll search for you!",
    };
    return messages[language] ?? messages[Language.EN];
  }

  private getMcpErrorMessage(language: Language): string {
    const messages: Record<Language, string> = {
      [Language.EN]:
        "I'm having trouble reaching the Kapruka catalog right now. Please try again in a moment.",
      [Language.SI]:
        'Kapruka සමඟ සම්බන්ධ වීමට ගැටලුවක් ඇත. කරුණාකර නැවත උත්සාහ කරන්න.',
      [Language.SINGLISH]:
        "Aiyo, can't reach Kapruka right now machan. Try again in a bit ah?",
    };
    return messages[language] ?? messages[Language.EN];
  }

  private lastHumanMessageText(state: AgentState): string {
    const last = [...state.messages]
      .reverse()
      .find((m) => m._getType() === 'human');
    return typeof last?.content === 'string' ? last.content : '';
  }
}
