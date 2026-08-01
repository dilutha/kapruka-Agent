import { Injectable, Logger } from '@nestjs/common';
import { AgentState } from '../agent-orchestrator';
import { McpClientService } from '../../../mcp/mcp-client.service';
import { PromptLibrary } from '../prompts/prompt-library';
import { GeminiService } from '../../gemini/gemini.service';
import { Language } from '@prisma/client';

/**
 * Handles RECOMMEND intent ("what should I get for my mom?", "gift ideas").
 *
 * There is no real `getProductRecommendations` MCP tool on the live server
 * (confirmed against `client.listTools()` — only `kapruka_search_products`
 * and a handful of others exist) — this used to call a tool that always
 * failed, silently degrading to a canned "could not load" line on every
 * single RECOMMEND message. Using the real search tool with an
 * occasion/budget-derived query makes this intent actually return grounded
 * products, same as SEARCH.
 */
@Injectable()
export class RecommendationNode {
  private readonly logger = new Logger(RecommendationNode.name);

  constructor(
    private readonly mcp: McpClientService,
    private readonly prompts: PromptLibrary,
    private readonly gemini: GeminiService,
  ) {}

  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    const query = state.searchQuery ?? state.occasion ?? 'gift ideas';

    try {
      const result = await this.mcp.searchProducts({
        query,
        maxPrice: state.budget,
        language: state.language === Language.SI ? 'si' : 'en',
        limit: 8,
      });

      if (result.products.length === 0) {
        return {
          searchResults: [],
          response: this.getEmptyMessage(state.language),
          responseType: 'text',
        };
      }

      const groundedContext = JSON.stringify({
        occasion: state.occasion ?? null,
        budget: state.budget ?? null,
        products: result.products.map((p) => ({
          id: p.id,
          name: p.name,
          priceMin: p.priceMin,
          currency: p.currency,
          category: p.category,
          isAvailable: p.isAvailable,
        })),
      });

      const response = await this.gemini.generateText({
        systemInstruction: this.prompts.getRecommendationPrompt(
          state.language,
          state.occasion,
        ),
        messages: [
          {
            role: 'user',
            text: `Recommendation request. Kapruka results JSON:\n${groundedContext}`,
          },
        ],
        temperature: 0.4,
        maxOutputTokens: 400,
      });

      return {
        searchResults: result.products,
        response,
        responseType: 'product_list',
      };
    } catch (error) {
      this.logger.error('Recommendation search failed:', error);
      return {
        searchResults: [],
        response: this.getEmptyMessage(state.language),
        responseType: 'text',
      };
    }
  }

  private getEmptyMessage(language: Language): string {
    const messages: Record<Language, string> = {
      [Language.EN]:
        "I couldn't find recommendations for that right now — want to try a specific category, like cakes, flowers, or electronics?",
      [Language.SI]:
        'දැනට recommendations හොයාගන්න බැරි වුනා — category එකක් කියන්න, cakes, flowers වගේ?',
      [Language.SINGLISH]:
        "Aiyo, couldn't find anything for that machan. Try a category like cakes or flowers?",
    };
    return messages[language] ?? messages[Language.EN];
  }
}
