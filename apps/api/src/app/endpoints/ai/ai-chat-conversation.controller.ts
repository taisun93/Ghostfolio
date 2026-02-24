import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { AiChatConversationService } from './ai-chat-conversation.service';

interface PostMessageBody {
  role?: string;
  content?: string;
}

@Controller('ai-chat')
export class AiChatConversationController {
  public constructor(
    private readonly conversationService: AiChatConversationService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Get('messages')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getMessages() {
    const userId = this.request.user.id;
    return this.conversationService.getLatestMessages(userId);
  }

  @Post('messages')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async postMessage(@Body() body: PostMessageBody) {
    const userId = this.request.user.id;
    const role = body.role === 'user' || body.role === 'assistant' ? body.role : null;
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!role || !content) {
      return { message: 'Missing or invalid role/content' };
    }
    const message = await this.conversationService.appendMessage(
      userId,
      role,
      content
    );
    return {
      id: message.id,
      role: message.role,
      text: message.text,
      at: message.at
    };
  }

  @Post('new')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async postNew() {
    const userId = this.request.user.id;
    await this.conversationService.createNewConversation(userId);
    return { ok: true };
  }
}