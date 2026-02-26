import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Langfuse, LangfuseGenerationClient, LangfuseTraceClient } from 'langfuse';

export type AiAgentErrorCategory =
  | 'api_error'
  | 'timeout_error'
  | 'tool_error'
  | 'verification_error'
  | 'validation_error'
  | 'unknown';

export interface AiAgentTelemetryEntry {
  type: 'ai_agent_telemetry';
  traceId: string;
  userId: string;
  duration: number;
  toolCalls: string[];
  toolCallCount: number;
  toolTimings: { name: string; durationMs: number }[];
  llmLatencyMs?: number;
  steps: number;
  confidence: number;
  tokensUsed?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost?: number;
  messageLength: number;
  timestamp: string;
}

export interface AiAgentErrorEntry {
  type: 'ai_agent_error';
  traceId: string;
  userId: string;
  duration: number;
  error: string;
  errorCategory: AiAgentErrorCategory;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

@Injectable()
export class TelemetryService implements OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly langfuse: Langfuse | null;

  public constructor() {
    const hasSecret = !!process.env.LANGFUSE_SECRET_KEY;
    const hasPublic = !!process.env.LANGFUSE_PUBLIC_KEY;
    const baseUrl =
      process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_BASE_URL;

    if (hasSecret && hasPublic) {
      this.langfuse = new Langfuse();
      this.logger.log(
        `Langfuse client initialized (baseUrl: ${baseUrl || 'https://cloud.langfuse.com'})`
      );
    } else {
      this.langfuse = null;
      this.logger.warn(
        `Langfuse disabled — missing env vars: ${[
          !hasSecret && 'LANGFUSE_SECRET_KEY',
          !hasPublic && 'LANGFUSE_PUBLIC_KEY'
        ]
          .filter(Boolean)
          .join(', ')}`
      );
    }
  }

  public async onModuleDestroy() {
    if (this.langfuse) {
      await this.langfuse.shutdownAsync();
    }
  }

  public logRequest(entry: AiAgentTelemetryEntry): void {
    this.logger.log(JSON.stringify(entry));
  }

  public logError(entry: AiAgentErrorEntry): void {
    this.logger.error(JSON.stringify(entry));
  }

  public createTraceId(): string {
    return crypto.randomUUID();
  }

  public createTrace({
    traceId,
    name,
    userId,
    input,
    tags
  }: {
    traceId: string;
    name: string;
    userId: string;
    input: string;
    tags?: string[];
  }): LangfuseTraceClient | null {
    if (!this.langfuse) {
      return null;
    }

    return this.langfuse.trace({
      id: traceId,
      name,
      userId,
      sessionId: `session-${userId}`,
      input,
      tags: tags ?? ['ai-agent', 'ghostfolio']
    });
  }

  public createGeneration({
    trace,
    name,
    model,
    input
  }: {
    trace: LangfuseTraceClient | null;
    name: string;
    model: string;
    input: unknown;
  }): LangfuseGenerationClient | null {
    if (!trace) {
      return null;
    }

    return trace.generation({
      name,
      model,
      input
    });
  }

  public endGeneration({
    generation,
    output,
    usage
  }: {
    generation: LangfuseGenerationClient | null;
    output: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }): void {
    if (!generation) {
      return;
    }

    generation.end({
      output,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens
      }
    });
  }

  public async flush(): Promise<void> {
    if (!this.langfuse) {
      return;
    }

    await this.langfuse.flushAsync();
  }

  public measureDuration(startTime: number): number {
    return Math.round(performance.now() - startTime);
  }

  public reportLangfuseScores({
    traceId,
    confidence,
    hallucinationScore,
    toolCallCount
  }: {
    traceId: string;
    confidence: number;
    hallucinationScore?: number;
    toolCallCount: number;
  }): void {
    if (!this.langfuse) {
      return;
    }

    this.langfuse.score({
      traceId,
      name: 'confidence',
      value: confidence
    });

    if (hallucinationScore !== undefined) {
      this.langfuse.score({
        traceId,
        name: 'hallucination',
        value: hallucinationScore
      });
    }

    this.langfuse.score({
      traceId,
      name: 'tool-call-count',
      value: toolCallCount
    });
  }

  public reportLangfuseScore({
    traceId,
    name,
    value,
    comment
  }: {
    traceId: string;
    name: string;
    value: number;
    comment?: string;
  }): void {
    if (!this.langfuse) {
      return;
    }

    this.langfuse.score({
      traceId,
      name,
      value,
      comment
    });
  }

  public categorizeError(error: unknown): AiAgentErrorCategory {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      const name = error.constructor?.name ?? '';

      if (
        name === 'AbortError' ||
        name === 'TimeoutError' ||
        msg.includes('abort') ||
        msg.includes('signal') ||
        msg.includes('timed out')
      ) {
        return 'timeout_error';
      }

      if (
        name === 'HttpException' ||
        msg.includes('validation') ||
        msg.includes('invalid') ||
        msg.includes('required')
      ) {
        return 'validation_error';
      }

      if (
        msg.includes('api') ||
        msg.includes('anthropic') ||
        msg.includes('rate limit') ||
        msg.includes('timeout') ||
        msg.includes('network')
      ) {
        return 'api_error';
      }

      if (
        msg.includes('verification') ||
        msg.includes('hallucination') ||
        msg.includes('accuracy')
      ) {
        return 'verification_error';
      }

      if (msg.includes('tool') || msg.includes('execute')) {
        return 'tool_error';
      }
    }

    return 'unknown';
  }
}
