import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { GuestTokenService } from './security.config';

@Module({
  imports: [ConfigModule],
  providers: [GuestTokenService],
  exports: [GuestTokenService],
})
export class SecurityModule {}