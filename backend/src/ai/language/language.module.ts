import { Module } from '@nestjs/common';
import { LanguageDetector } from './language-detector';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [GeminiModule],
  providers: [LanguageDetector],
  exports: [LanguageDetector],
})
export class LanguageModule {}
