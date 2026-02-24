import { IsIn, IsOptional, IsString } from 'class-validator';

export class AiAgentFeedbackDto {
  @IsString()
  traceId: string;

  @IsIn(['up', 'down'])
  rating: 'up' | 'down';

  @IsString()
  @IsOptional()
  correction?: string;
}
