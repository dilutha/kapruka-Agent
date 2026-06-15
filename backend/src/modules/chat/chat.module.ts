import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatRepository } from './repositories/chat.repository';
import { MessageRepository } from './repositories/message.repository';
import { AgentModule } from '../../ai/agent/agent.module';
import { OptionalAuthGuard } from '../auth/guards/optional-auth.guard';
import { LoggingInterceptor } from '../../common/interceptors/logging.interceptor';

@Module({
  imports: [AgentModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatRepository,
    MessageRepository,
    OptionalAuthGuard,
    LoggingInterceptor,
  ],
})
export class ChatModule {}
