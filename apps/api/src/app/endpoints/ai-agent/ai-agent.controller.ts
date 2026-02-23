import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import type { AiAgentResponse } from '@ghostfolio/common/interfaces';
import { permissions } from '@ghostfolio/common/permissions';

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AiAgentService } from './ai-agent.service';
import { AiAgentChatDto } from './dto/ai-agent-chat.dto';

@Controller('ai-agent')
export class AiAgentController {
  public constructor(private readonly aiAgentService: AiAgentService) {}

  @HasPermission(permissions.accessAiAgent)
  @Post('chat')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async chat(
    @Body() { conversationHistory, message }: AiAgentChatDto
  ): Promise<AiAgentResponse> {
    return this.aiAgentService.chat({
      conversationHistory,
      message
    });
  }
}
