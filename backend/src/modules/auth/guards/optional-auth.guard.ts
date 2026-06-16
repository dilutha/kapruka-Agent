import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { Request, Response } from 'express';

import { PrismaService } from '../../../prisma/prisma.service';
import { GuestTokenService } from '../../../common/security/security.config';

interface AuthenticatedRequest extends Request {
  user?: unknown;
  guestUser?: unknown;
}

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guestTokenService: GuestTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();

    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const authHeader = request.headers.authorization;
    const guestToken = request.headers['x-guest-token'];

    // Attempt Clerk authentication
    if (
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ')
    ) {
      const token = authHeader.slice(7);

      try {
        const secretKey = process.env.CLERK_SECRET_KEY;

        if (secretKey) {
          const payload = await verifyToken(token, {
            secretKey,
          });

          if (payload.sub) {
            const user = await this.prisma.user.findUnique({
              where: {
                clerkId: payload.sub,
              },
            });

            if (user) {
              request.user = user;
            }
          }
        }
      } catch {
        // Invalid or expired token; continue as guest
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

