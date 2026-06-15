import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { clerkClient } from '@clerk/clerk-sdk-node';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { GuestTokenService } from '../../../common/security/security.config';

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guestTokenService: GuestTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization as string | undefined;
    const guestToken = request.headers['x-guest-token'] as string | undefined;

    // Try Clerk JWT authentication
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const { sub } = await clerkClient.verifyToken(token);
        const user = await this.prisma.user.findUnique({ where: { clerkId: sub } });
        if (user) request.user = user;
      } catch { /* token invalid — continue as guest */ }
    }

    // Try guest token
    if (!request.user && guestToken) {
      const result = this.guestTokenService.verify(guestToken);
      if (result.valid && result.id) {
        const guestUser = await this.prisma.guestUser.findUnique({
          where: { sessionToken: guestToken },
        });
        if (guestUser) request.guestUser = guestUser;
      }
    }

    // Auto-create guest session if no auth found
    if (!request.user && !request.guestUser) {
      const token = this.guestTokenService.generate();
      const guestUser = await this.prisma.guestUser.create({
        data: {
          sessionToken: token,
          expiresAt:    new Date(Date.now() + 72 * 3600 * 1000),
          ipAddress:    request.ip,
        },
      });
      request.guestUser = guestUser;
      // Send the token back in response header
      const response = context.switchToHttp().getResponse();
      response.setHeader('X-Guest-Token', token);
    }

    return true; // Always allow — auth is optional
  }
}