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

@Module({
  imports: [McpModule, ProductModule],
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
  exports: [AgentOrchestrator],
})
export class AgentModule {}
