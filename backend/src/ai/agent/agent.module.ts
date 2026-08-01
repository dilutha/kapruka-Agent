import { Module } from '@nestjs/common';
import { AgentOrchestrator } from './agent-orchestrator';
import { IntentClassifier } from './nodes/intent-classifier.node';
import { ProductSearchNode } from './nodes/product-search.node';
import { RecommendationNode } from './nodes/recommendation.node';
import { CheckoutNode } from './nodes/checkout.node';
import { TrackingNode } from './nodes/tracking.node';
import { GiftNode } from './nodes/gift.node';
import { PromptLibrary } from './prompts/prompt-library';
import { LanguageDetector } from '../language/language-detector';
import { McpModule } from '../../mcp/mcp.module';
import { ProductModule } from '../../modules/product/product.module';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [McpModule, ProductModule, GeminiModule],
  providers: [
    AgentOrchestrator,
    IntentClassifier,
    ProductSearchNode,
    RecommendationNode,
    CheckoutNode,
    TrackingNode,
    GiftNode,
    PromptLibrary,
    LanguageDetector,
  ],
  // IntentClassifier is exported so ChatService can run it *concurrently*
  // with language detection (see ChatService.sendMessageStream) instead of
  // strictly after it — the graph's own intent_classifier node then skips
  // its call entirely when it sees the result already seeded into state.
  exports: [AgentOrchestrator, IntentClassifier],
})
export class AgentModule {}
