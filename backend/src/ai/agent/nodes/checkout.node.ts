import { Injectable } from '@nestjs/common';
import { AgentState } from '../agent-orchestrator';

@Injectable()
export class CheckoutNode {
  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    // Full implementation in Sprint 4
    return { response: 'Let me help you checkout. What delivery address should I use?', responseType: 'checkout' };
  }
}