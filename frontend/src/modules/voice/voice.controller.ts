import { Controller, Post, Body, UploadedFile, UseInterceptors, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

@Controller('voice')
export class VoiceController {
  private readonly openai: OpenAI;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.getOrThrow('OPENAI_API_KEY') });
  }

  /** STT: audio file → transcript text */
  @Post('transcribe')
  @UseInterceptors(FileInterceptor('audio'))
  async transcribe(@UploadedFile() file: Express.Multer.File): Promise<{ text: string }> {
    const blob = new Blob([file.buffer], { type: file.mimetype });
    const audioFile = new File([blob], 'audio.webm', { type: file.mimetype });
    const result = await this.openai.audio.transcriptions.create({
      file:  audioFile,
      model: 'whisper-1',
    });
    return { text: result.text };
  }

  /** TTS: text → audio stream */
  @Post('speak')
  async speak(@Body() body: { text: string; voice?: string }, @Res() res: Response) {
    const mp3 = await this.openai.audio.speech.create({
      model: 'tts-1',
      voice: (body.voice ?? 'alloy') as any,
      input: body.text.slice(0, 4096),
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');

    const buffer = Buffer.from(await mp3.arrayBuffer());
    const readable = Readable.from(buffer);
    readable.pipe(res);
  }
}