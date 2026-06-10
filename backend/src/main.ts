import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import {
  buildHelmetConfig,
  buildCorsConfig,
  buildRateLimiters,
  validateSecrets,
} from './common/security/security.config';
import { InputSanitizationPipe } from './common/security/security.middleware';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Validate all required environment variables on startup
  // Hard-fails if any secret is missing — prevents partial deployments
  validateSecrets(process.env as NodeJS.ProcessEnv);

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const config = app.get(ConfigService);
  const port   = config.get<number>('app.port', 3001);

  // Security middleware
  app.use(buildHelmetConfig());
  app.enableCors(buildCorsConfig(config.get('app.corsAllowedOrigins', [])));

  // Rate limiting
  const rateLimiters = buildRateLimiters(config.get('redis.url', 'redis://localhost:6379'));
  app.use(rateLimiters.global);
  app.use('/chats', rateLimiters.chat);
  app.use('/auth', rateLimiters.auth);
  app.use('/voice', rateLimiters.voice);

  // Global validation + sanitization
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    new InputSanitizationPipe(),
  );

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger (development only)
  if (config.get('app.nodeEnv') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Kapruka Agent API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, doc);
    logger.log(`Swagger: http://localhost:${port}/api/docs`);
  }

  await app.listen(port);
  logger.log(`Backend running on http://localhost:${port}`);
}

bootstrap();