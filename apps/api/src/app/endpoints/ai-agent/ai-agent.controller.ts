import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import type { AiAgentResponse } from '@ghostfolio/common/interfaces';
import type { RequestWithUser } from '@ghostfolio/common/types';
import { permissions } from '@ghostfolio/common/permissions';

import {
  Body,
  Controller,
  Inject,
  Logger,
  Post,
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
  @Post('chat')
  @Throttle({ chat: { ttl: 60_000, limit: 10 } })
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard, ThrottlerGuard)
  public async chat(
    @Body() { conversationHistory, message }: AiAgentChatDto
  ): Promise<AiAgentResponse> {
    return this.aiAgentService.chat({
      conversationHistory,
      message
    });
  }

  @HasPermission(permissions.accessAiAgent)
  @Post('chat/stream')
  @Throttle({ chat: { ttl: 60_000, limit: 10 } })
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard, ThrottlerGuard)
  public async chatStream(
    @Body() { conversationHistory, message }: AiAgentChatDto,
    @Res() res: Response
  ) {
    const { result, traceId, toolNamesPromise } =
      await this.aiAgentService.chatStream({
        conversationHistory,
        message
      });

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
      'X-Trace-Id': traceId
    });

    try {
      for await (const textPart of result.textStream) {
        res.write(textPart);
      }
      const toolNames = await toolNamesPromise;
      res.write('\n__TOOLS__:' + JSON.stringify(toolNames));
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
