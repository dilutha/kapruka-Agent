import { Injectable, Logger } from '@nestjs/common';
import { AgentState } from '../agent-orchestrator';
import { McpClientService } from '../../../mcp/mcp-client.service';
import { PromptLibrary } from '../prompts/prompt-library';
import { GeminiService } from '../../gemini/gemini.service';
import { Language } from '@prisma/client';

/**
 * Handles GIFT intent. Same real-tool fix as RecommendationNode — see its
 * header comment for why this no longer calls the nonexistent
 * `getProductRecommendations` tool.
 */
@Injectable()
export class GiftNode {
  private readonly logger = new Logger(GiftNode.name);

  constructor(
    private readonly mcp: McpClientService,
    private readonly prompts: PromptLibrary,
    private readonly gemini: GeminiService,
  ) {}

  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    const occasion = state.occasion ?? 'gift';
    const query = state.searchQuery ?? `${occasion} gift`;

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
        occasion,
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
        systemInstruction: this.prompts.getGiftPrompt(
          state.language,
          occasion,
          state.budget,
        ),
        messages: [
          {
            role: 'user',
            text: `Gift request. Kapruka results JSON:\n${groundedContext}`,
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
      this.logger.error('Gift search failed:', error);
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
        "I couldn't find gift options for that right now — tell me a bit more about who it's for and I'll try again?",
      [Language.SI]:
        'දැනට gift options හොයාගන්න බැරි වුනා — කාටද කියලා ටිකක් කියන්න.',
      [Language.SINGLISH]:
        "Aney, couldn't find gifts for that machan. Tell me more about who it's for ah?",
    };
    return messages[language] ?? messages[Language.EN];
  }
}
