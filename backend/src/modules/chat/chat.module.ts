import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatRepository } from './repositories/chat.repository';
import { MessageRepository } from './repositories/message.repository';
import { LanguageModule } from '../../ai/language/language.module';
import { AgentModule } from '../../ai/agent/agent.module';
import { SecurityModule } from '../../common/security/security.module';

import { OptionalAuthGuard } from '../auth/guards/optional-auth.guard';
import { LoggingInterceptor } from '../../common/interceptors/logging.interceptor';
import { PromptInjectionGuard } from '../../common/security/security.middleware';
import { PromptLibrary } from '../../ai/agent/prompts/prompt-library';

@Module({
  imports: [AgentModule, LanguageModule, SecurityModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatRepository,
    MessageRepository,
    OptionalAuthGuard,
    PromptInjectionGuard,
    LoggingInterceptor,
    PromptLibrary,
  ],
})
export class ChatModule {}
