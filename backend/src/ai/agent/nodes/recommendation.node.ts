import { Injectable } from '@nestjs/common';
import { AgentState } from '../agent-orchestrator';
import { McpClientService } from '../../../mcp/mcp-client.service';

@Injectable()
export class RecommendationNode {
  constructor(private readonly mcp: McpClientService) {}

  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    try {
      const results = await this.mcp.getProductRecommendations({
        language: state.language === 'SI' ? 'si' : 'en',
      });
      return { searchResults: results.products, responseType: 'product_list' };
    } catch {
      return { response: 'Could not load recommendations right now.', responseType: 'text' };
    }
  }
}
