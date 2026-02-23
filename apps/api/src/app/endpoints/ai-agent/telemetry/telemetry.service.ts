import { Injectable, Logger } from '@nestjs/common';

export interface AiAgentTelemetryEntry {
  type: 'ai_agent_telemetry';
  traceId: string;
  userId: string;
  duration: number;
  toolCalls: string[];
  toolCallCount: number;
  steps: number;
  confidence: number;
  tokensUsed?: { promptTokens: number; completionTokens: number; totalTokens: number };
  messageLength: number;
  timestamp: string;
}

export interface AiAgentErrorEntry {
  type: 'ai_agent_error';
  traceId: string;
  userId: string;
  duration: number;
  error: string;
  timestamp: string;
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  public logRequest(entry: AiAgentTelemetryEntry): void {
    this.logger.log(JSON.stringify(entry));
  }

  public logError(entry: AiAgentErrorEntry): void {
    this.logger.error(JSON.stringify(entry));
  }

  public createTraceId(): string {
    return crypto.randomUUID();
  }

  public measureDuration(startTime: number): number {
    return Math.round(performance.now() - startTime);
  }
}
