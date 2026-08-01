/**
 * Chat Controller
 *
 * Handles real-time conversational interactions. Supports:
 *  - Streaming AI responses via Server-Sent Events (SSE)
 *  - Session continuity for both authenticated and guest users
 *  - Language-aware request handling
 *
 * Routes:
 *  POST   /chats                — create new chat session
 *  GET    /chats                — list user's chat history (?archived=true for archived)
 *  GET    /chats/:id            — get single chat with messages
 *  PATCH  /chats/:id            — rename chat
 *  PATCH  /chats/:id/pin        — pin/unpin chat
 *  POST   /chats/:id/archive    — archive chat (recoverable)
 *  POST   /chats/:id/unarchive  — restore an archived chat
 *  POST   /chats/:id/duplicate  — duplicate chat + its messages
 *  POST   /chats/:id/messages   — send message, stream response
 *  DELETE /chats/:id            — soft-delete chat (not recoverable via UI)
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { ChatService } from './chat.service';
import { CreateChatDto } from './dto/create-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateChatDto } from './dto/update-chat.dto';
import { PinChatDto } from './dto/pin-chat.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { OptionalAuthGuard } from '../auth/guards/optional-auth.guard';
import { LoggingInterceptor } from '../../common/interceptors/logging.interceptor';
import { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { PromptInjectionGuard } from '../../common/security/security.middleware';

@ApiTags('Chat')
@ApiSecurity('bearer')
@UseInterceptors(LoggingInterceptor)
@UseGuards(OptionalAuthGuard, PromptInjectionGuard) // Works for both authed and guest users
@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new chat session' })
  @ApiResponse({ status: 201, type: ChatResponseDto })
  async createChat(
    @Body() dto: CreateChatDto,
    @Req() req: RequestWithUser,
  ): Promise<ChatResponseDto> {
    return this.chatService.createChat({
      dto,
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List all chats for current user' })
  @ApiResponse({ status: 200, type: [ChatResponseDto] })
  async listChats(
    @Req() req: RequestWithUser,
    @Query('archived', new ParseBoolPipe({ optional: true }))
    archived?: boolean,
  ): Promise<ChatResponseDto[]> {
    return this.chatService.listChats({
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
      archived,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get chat with messages' })
  @ApiResponse({ status: 200, type: ChatResponseDto })
  async getChat(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Req() req: RequestWithUser,
  ): Promise<ChatResponseDto> {
    return this.chatService.getChat({
      chatId,
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a chat' })
  @ApiResponse({ status: 200, type: ChatResponseDto })
  async renameChat(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Body() dto: UpdateChatDto,
    @Req() req: RequestWithUser,
  ): Promise<ChatResponseDto> {
    return this.chatService.renameChat({
      chatId,
      dto,
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
    });
  }

  @Patch(':id/pin')
  @ApiOperation({ summary: 'Pin or unpin a chat' })
  @ApiResponse({ status: 200, type: ChatResponseDto })
  async setPinned(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Body() dto: PinChatDto,
    @Req() req: RequestWithUser,
  ): Promise<ChatResponseDto> {
    return this.chatService.setPinned({
      chatId,
      isPinned: dto.isPinned,
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
    });
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a chat (recoverable)' })
  @ApiResponse({ status: 200, type: ChatResponseDto })
  async archiveChat(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Req() req: RequestWithUser,
  ): Promise<ChatResponseDto> {
    return this.chatService.archiveChat({
      chatId,
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
    });
  }

  @Post(':id/unarchive')
  @ApiOperation({ summary: 'Restore an archived chat' })
  @ApiResponse({ status: 200, type: ChatResponseDto })
  async unarchiveChat(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Req() req: RequestWithUser,
  ): Promise<ChatResponseDto> {
    return this.chatService.unarchiveChat({
      chatId,
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
    });
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Duplicate a chat and its messages' })
  @ApiResponse({ status: 201, type: ChatResponseDto })
  async duplicateChat(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Req() req: RequestWithUser,
  ): Promise<ChatResponseDto> {
    return this.chatService.duplicateChat({
      chatId,
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
    });
  }

  /**
   * Streaming endpoint — returns Server-Sent Events.
   *
   * The AI agent processes the message and streams:
   *  - text/delta  : partial assistant text tokens
   *  - tool/call   : tool invocation notification
   *  - tool/result : tool result (product cards, etc.)
   *  - done        : final message id + metadata
   *  - error       : error event with code and message
   *
   * Client should use EventSource or the fetch streaming API.
   */
  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send message and stream AI response (SSE)' })
  async sendMessage(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Body() dto: SendMessageDto,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ): Promise<void> {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    await this.chatService.sendMessageStream({
      chatId,
      dto,
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
      res,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete chat session' })
  async deleteChat(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    await this.chatService.deleteChat({
      chatId,
      userId: req.user?.id,
      guestUserId: req.guestUser?.id,
    });
  }
}
