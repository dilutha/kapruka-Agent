import { Injectable, Logger } from '@nestjs/common';
import { AgentState } from '../agent-orchestrator';
import {
  McpClientService,
  McpToolError,
} from '../../../mcp/mcp-client.service';
import { GeminiService } from '../../gemini/gemini.service';
import { PromptLibrary } from '../prompts/prompt-library';
import { Language } from '@prisma/client';

/**
 * `state.orderRef` here means the order NUMBER the shopper types in (e.g.
 * from their Kapruka confirmation email) — set by IntentClassifier's
 * `extracted.orderId` for a TRACK message. This is NOT the same value
 * checkout.node.ts writes to `orderRef` after `kapruka_create_order` (that's
 * a pre-payment reference) — see mcp-client.service.ts's file-level doc
 * comment. Both intents never run in the same turn, so the field is never
 * ambiguous in practice, but the two meanings are worth keeping straight.
 */
@Injectable()
export class TrackingNode {
  private readonly logger = new Logger(TrackingNode.name);

  constructor(
    private readonly mcp: McpClientService,
    private readonly gemini: GeminiService,
    private readonly prompts: PromptLibrary,
  ) {}

  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    if (!state.orderRef) {
      return {
        response: this.askForOrderNumber(state.language),
        responseType: 'text',
      };
    }

    try {
      const tracking = await this.mcp.trackOrder(state.orderRef);

      const response = await this.gemini.generateText({
        systemInstruction: this.prompts.getTrackingPrompt(state.language),
        messages: [
          {
            role: 'user',
            text: JSON.stringify({
              order_number: tracking.order_number,
              status: tracking.status_display,
              order_date: tracking.order_date,
              delivery_date: tracking.delivery_date,
              shipped_date: tracking.shipped_date,
              recipient: tracking.recipient,
              items: tracking.items,
              progress: tracking.progress,
              special_instructions: tracking.special_instructions,
            }),
          },
        ],
        temperature: 0.3,
        maxOutputTokens: 400,
      });

      return { response, responseType: 'order_status' };
    } catch (error) {
      if (error instanceof McpToolError) {
        return {
          response: this.notFoundMessage(state.language, state.orderRef),
          responseType: 'text',
        };
      }
      this.logger.error('trackOrder failed:', error);
      return {
        response: this.notFoundMessage(state.language, state.orderRef),
        responseType: 'text',
      };
    }
  }

  private askForOrderNumber(language: Language): string {
    const messages: Record<Language, string> = {
      [Language.EN]:
        "Sure — what's your order number? It's in the confirmation email Kapruka sent after you paid (e.g. VIMP34456CB2).",
      [Language.SI]:
        'ඔබේ order number එක කියන්න — payment කරාට පස්සේ Kapruka එවපු confirmation email එකේ තියෙනවා (උදා: VIMP34456CB2).',
      [Language.SINGLISH]:
        'Order number eka kiyanna machan — payment karapu passe Kapruka evapu confirmation email eke thiyenawa (eg: VIMP34456CB2).',
    };
    return messages[language] ?? messages[Language.EN];
  }

  private notFoundMessage(language: Language, orderRef: string): string {
    const messages: Record<Language, string> = {
      [Language.EN]: `I couldn't find an order with number "${orderRef}". Please double-check the number from your confirmation email, or contact Kapruka support if you're sure it's correct.`,
      [Language.SI]: `"${orderRef}" number එකට order එකක් හම්බුනේ නෑ. confirmation email එකේ number එක check කරන්න, නැත්නම් Kapruka support එකට කතා කරන්න.`,
      [Language.SINGLISH]: `"${orderRef}" kiyana number ekata order ekak hambune na machan. Confirmation email eke number eka ayeth check karanna, nathnam Kapruka support ekata katha karanna.`,
    };
    return messages[language] ?? messages[Language.EN];
  }
}
