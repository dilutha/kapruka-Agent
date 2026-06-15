/**
 * Root Application Module
 *
 * Orchestrates all feature modules following Clean Architecture.
 * Each feature module is self-contained with its own:
 *  - Domain entities & value objects
 *  - Application services & use-case handlers
 *  - Infrastructure adapters (repositories, external clients)
 *  - Presentation layer (controllers, resolvers)
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';

// Config
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { redisConfig } from './config/redis.config';
import { aiConfig } from './config/ai.config';

// Infrastructure
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

// Feature modules
import { ChatModule } from './modules/chat/chat.module';
import { ProductModule } from './modules/product/product.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

// AI layer
import { AgentModule } from './ai/agent/agent.module';
import { McpModule } from './mcp/mcp.module';

// Common
import { HealthModule } from './common/health/health.module';

@Module({
  imports: [
    // Global configuration — available everywhere via ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, aiConfig],
      expandVariables: true,
    }),

    // Rate limiting — global guard applied in main.ts
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { ttl: 60_000, limit: config.get('app.rateLimitPerMinute', 60) },
        ],
      }),
    }),

    // Internal event bus (domain events)
    EventEmitterModule.forRoot({ wildcard: true }),

    // Background job queues
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
          password: config.get('redis.password'),
        },
      }),
    }),

    // Cron jobs
    ScheduleModule.forRoot(),

    // Infrastructure
    PrismaModule,
    RedisModule,
    HealthModule,

    // AI + MCP
    McpModule,
    AgentModule,

    // Feature modules
    ChatModule,
    ProductModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
