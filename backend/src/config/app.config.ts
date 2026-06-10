import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port:               parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv:            process.env.NODE_ENV ?? 'development',
  nextjsUrl:          process.env.NEXTJS_URL ?? 'http://localhost:3000',
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '').split(','),
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MIN ?? '120', 10),
}));