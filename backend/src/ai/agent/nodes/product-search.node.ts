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
import { ChatOpenAI } from '@langchain/openai';
import {
  SystemMessage,
  AIMessage,
  ToolMessage,
} from '@langchain/core/messages';

import { AgentState } from '../agent-orchestrator';
import { McpClientService } from '../../../mcp/mcp-client.service';
import { PromptLibrary } from '../prompts/prompt-library';
import { ProductCacheRepository } from '../../../modules/product/repositories/product-cache.repository';
import { Language } from '@prisma/client';

@Injectable()
export class ProductSearchNode {
  private readonly logger = new Logger(ProductSearchNode.name);
  private readonly model: ChatOpenAI;

  constructor(
    private readonly mcpClient: McpClientService,
    private readonly prompts: PromptLibrary,
    private readonly productCache: ProductCacheRepository,
  ) {
    this.model = new ChatOpenAI({
      model: 'gpt-4o',
      temperature: 0.3, // Slightly creative for natural phrasing, not for facts
      streaming: true,
    });
  }

  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    const { searchQuery, language, messages } = state;

    if (!searchQuery) {
      return {
        response: this.getNoQueryMessage(language),
        responseType: 'text',
      };
    }

    this.logger.log(`Product search: "${searchQuery}" [${language}]`);

    // Step 1: Check product cache first
    const cached = await this.productCache.findByQuery(searchQuery);

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
        });
        searchResults = mcpResult.products;

        // Step 3: Cache results
        if (searchResults.length > 0) {
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

    // Step 4: Build tool-grounded context for the LLM
    // Inject results as a ToolMessage so the model sees them as ground truth
    const toolCallId = `search_${Date.now()}`;
    const groundedMessages = [
      new SystemMessage(this.prompts.getProductSearchPrompt(language)),
      ...messages.slice(-10), // Recent conversation context
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: toolCallId,
            name: 'searchProducts',
            args: { query: searchQuery },
          },
        ],
      }),
      new ToolMessage({
        tool_call_id: toolCallId,
        content: JSON.stringify({
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
        }),
      }),
    ];

    // Step 5: Generate grounded response
    const response = await this.model.invoke(groundedMessages);

    return {
      searchResults,
      response: response.content as string,
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
      [Language.EN]: "What are you looking for? Tell me a product name, category, or occasion and I'll search Kapruka for you.",
      [Language.SI]: "ඔබ සොයන දෙය කුමක්ද? නිෂ්පාදනයේ නමක් හෝ ප්‍රවර්ගයක් ලබා දෙන්න.",
      [Language.SINGLISH]: "What you want to find machan? Tell me product name or category, I'll search for you!",
    };
    return messages[language] ?? messages[Language.EN];
  }

  private getMcpErrorMessage(language: Language): string {
    const messages: Record<Language, string> = {
      [Language.EN]: "I'm having trouble reaching the Kapruka catalog right now. Please try again in a moment.",
      [Language.SI]: "Kapruka සමඟ සම්බන්ධ වීමට ගැටලුවක් ඇත. කරුණාකර නැවත උත්සාහ කරන්න.",
      [Language.SINGLISH]: "Aiyo, can't reach Kapruka right now machan. Try again in a bit ah?",
    };
    return messages[language] ?? messages[Language.EN];
  }
}
