import { Injectable } from '@nestjs/common';
import { AgentState } from '../agent-orchestrator';
import { McpClientService } from '../../../mcp/mcp-client.service';

@Injectable()
export class TrackingNode {
  constructor(private readonly mcp: McpClientService) {}
  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    if (!state.orderRef) return { response: 'Please provide your order number (e.g. KP12345).', responseType: 'text' };
    try {
      const tracking = await this.mcp.trackOrder(state.orderRef);
      return { response: `Order ${state.orderRef}: ${tracking.statusLabel}`, responseType: 'order_status' };
    } catch {
      return { response: `Could not find order ${state.orderRef}. Please check the order number.`, responseType: 'text' };
    }
  }
}