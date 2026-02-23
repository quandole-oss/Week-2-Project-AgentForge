import type { AiAgentMessage } from '@ghostfolio/common/interfaces';

import { IsArray, IsOptional, IsString } from 'class-validator';

export class AiAgentChatDto {
  @IsString()
  message: string;

  @IsArray()
  @IsOptional()
  conversationHistory?: AiAgentMessage[];
}
