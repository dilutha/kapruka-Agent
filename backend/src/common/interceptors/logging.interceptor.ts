import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, finalize } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      originalUrl: string;
    }>();
    const startedAt = Date.now();

    return next.handle().pipe(
      finalize(() => {
        this.logger.log(
          `${request.method} ${request.originalUrl} ${Date.now() - startedAt}ms`,
        );
      }),
    );
  }
}
