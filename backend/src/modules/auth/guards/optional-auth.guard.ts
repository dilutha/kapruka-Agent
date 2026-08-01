import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { Response } from 'express';

import { PrismaService } from '../../../prisma/prisma.service';
import { GuestTokenService } from '../../../common/security/security.config';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAuthGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly guestTokenService: GuestTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();

    const request = http.getRequest<RequestWithUser>();
    const response = http.getResponse<Response>();

    const authHeader = request.headers.authorization;
    const guestToken = request.headers['x-guest-token'];

    // Attempt Clerk authentication
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      try {
        const secretKey = process.env.CLERK_SECRET_KEY;

        if (!secretKey) {
          throw new UnauthorizedException(
            'Clerk authentication is not configured',
          );
        }

        const payload = (await verifyToken(token, {
          secretKey,
        })) as unknown;
        const clerkId = getClerkSubject(payload);

        if (clerkId) {
          const user = await this.prisma.user.findUnique({
            where: {
              clerkId,
            },
          });

          if (user) {
            request.user = user;
          } else {
            throw new UnauthorizedException(
              'Authenticated user is not registered',
            );
          }
        }
      } catch (error) {
        this.logger.warn('Rejected invalid Clerk bearer token');
        this.logger.debug(error);
        throw new UnauthorizedException(
          'Invalid or expired authentication token',
        );
      }
    }

    // Attempt guest authentication
    if (!request.user && typeof guestToken === 'string') {
      try {
        const result = this.guestTokenService.verify(guestToken);

        if (result.valid && result.id) {
          const guestUser = await this.prisma.guestUser.findUnique({
            where: {
              sessionToken: guestToken,
            },
          });

          if (guestUser) {
            request.guestUser = guestUser;
          }
        }
      } catch {
        // Invalid guest token; continue to create a new session
      }
    }

    // Create guest session if no authentication exists
    if (!request.user && !request.guestUser) {
      const token = this.guestTokenService.generate();

      const guestUser = await this.prisma.guestUser.create({
        data: {
          sessionToken: token,
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
          ipAddress: request.ip,
        },
      });

      request.guestUser = guestUser;

      response.setHeader('X-Guest-Token', token);
    }

    return true;
  }
}

function getClerkSubject(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('sub' in payload)) {
    return null;
  }

  const subject = payload.sub;
  return typeof subject === 'string' ? subject : null;
}
