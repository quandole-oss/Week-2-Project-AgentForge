import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import type { AiAgentResponse } from '@ghostfolio/common/interfaces';
import type { RequestWithUser } from '@ghostfolio/common/types';
import { permissions } from '@ghostfolio/common/permissions';

import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Post,
  Query,
  Res,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';

import { AiAgentService } from './ai-agent.service';
import { AiAgentChatDto } from './dto/ai-agent-chat.dto';
import { AiAgentFeedbackDto } from './dto/ai-agent-feedback.dto';

@Controller('ai-agent')
export class AiAgentController {
  private readonly logger = new Logger(AiAgentController.name);

  public constructor(
    private readonly aiAgentService: AiAgentService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @HasPermission(permissions.accessAiAgent)
  @Get('conversation')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getConversation(
    @Query('id') conversationId?: string
  ) {
    const userId = this.request.user.id;

    if (conversationId) {
      return this.aiAgentService.getConversation(
        conversationId,
        userId
      );
    }

    return this.aiAgentService.getOrCreateActiveConversation(userId);
  }

  @HasPermission(permissions.accessAiAgent)
  @Post('conversation')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async createConversation() {
    const userId = this.request.user.id;
    return this.aiAgentService.createConversation(userId);
  }

  @HasPermission(permissions.accessAiAgent)
  @Post('chat')
  @Throttle({ chat: { ttl: 60_000, limit: 10 } })
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard, ThrottlerGuard)
  public async chat(
    @Body()
    { conversationHistory, conversationId, message }: AiAgentChatDto
  ): Promise<AiAgentResponse> {
    return this.aiAgentService.chat({
      conversationHistory,
      conversationId,
      message
    });
  }

  @HasPermission(permissions.accessAiAgent)
  @Post('chat/stream')
  @Throttle({ chat: { ttl: 60_000, limit: 10 } })
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard, ThrottlerGuard)
  public async chatStream(
    @Body()
    { conversationHistory, conversationId, message }: AiAgentChatDto,
    @Res() res: Response
  ) {
    const {
      result,
      traceId,
      streamMetaPromise,
      conversationId: activeConversationId
    } = await this.aiAgentService.chatStream({
      conversationHistory,
      conversationId,
      message
    });

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
      'X-Trace-Id': traceId,
      'X-Conversation-Id': activeConversationId
    });

    try {
      for await (const textPart of result.textStream) {
        res.write(textPart);
      }
      const meta = await streamMetaPromise;
      res.write('\n__META__:' + JSON.stringify(meta));
    } catch (error) {
      this.logger.error(`Stream error [${traceId}]: ${error.message}`);
    } finally {
      res.end();
    }
  }

  @HasPermission(permissions.accessAiAgent)
  @Post('feedback')
  @Throttle({ feedback: { ttl: 60_000, limit: 30 } })
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard, ThrottlerGuard)
  public async feedback(
    @Body() { traceId, rating, correction }: AiAgentFeedbackDto
  ) {
    return this.aiAgentService.submitFeedback({
      traceId,
      rating,
      correction,
      userId: this.request.user.id
    });
  }
}
