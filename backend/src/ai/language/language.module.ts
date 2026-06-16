import { Module } from '@nestjs/common';
import { LanguageDetector } from './language-detector';

@Module({
  providers: [LanguageDetector],
  exports: [LanguageDetector],
})
export class LanguageModule {}