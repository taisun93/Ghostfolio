import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { AiPromptResponse } from '@ghostfolio/common/interfaces';
import { permissions } from '@ghostfolio/common/permissions';
import type { AiPromptMode, RequestWithUser } from '@ghostfolio/common/types';

import type { Response } from 'express';

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { AiChatRequestDto } from './ai-chat.dto';
import { AiChatService } from './ai-chat.service';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  public constructor(
    private readonly aiChatService: AiChatService,
    private readonly aiService: AiService,
    private readonly apiService: ApiService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Get('prompt/:mode')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getPrompt(
    @Param('mode') mode: AiPromptMode,
    @Query('accounts') filterByAccounts?: string,
    @Query('assetClasses') filterByAssetClasses?: string,
    @Query('dataSource') filterByDataSource?: string,
    @Query('symbol') filterBySymbol?: string,
    @Query('tags') filterByTags?: string
  ): Promise<AiPromptResponse> {
    const filters = this.apiService.buildFiltersFromQueryParams({
      filterByAccounts,
      filterByAssetClasses,
      filterByDataSource,
      filterBySymbol,
      filterByTags
    });

    const prompt = await this.aiService.getPrompt({
      filters,
      mode,
      impersonationId: undefined,
      languageCode: this.request.user.settings.settings.language,
      userCurrency: this.request.user.settings.settings.baseCurrency,
      userId: this.request.user.id
    });

    return { prompt };
  }

  @Post('chat')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async chat(@Body() body: AiChatRequestDto) {
    const filters = this.apiService.buildFiltersFromQueryParams({});
    return this.aiChatService.chat({
      filters,
      impersonationId: undefined,
      messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
      userCurrency: this.request.user.settings.settings.baseCurrency,
      userId: this.request.user.id
    });
  }

  @Post('chat/stream')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async chatStream(
    @Body() body: AiChatRequestDto,
    @Res() res: Response
  ): Promise<void> {
    const filters = this.apiService.buildFiltersFromQueryParams({});
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      for await (const chunk of this.aiChatService.chatStream({
        filters,
        impersonationId: undefined,
        messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
        userCurrency: this.request.user.settings.settings.baseCurrency,
        userId: this.request.user.id
      })) {
        if (chunk.chirp != null) {
          res.write(`event: chirp\ndata: ${JSON.stringify({ chirp: chunk.chirp })}\n\n`);
        }
        if (chunk.content != null) {
          res.write(`event: content\ndata: ${JSON.stringify({ content: chunk.content })}\n\n`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stream failed';
      res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
