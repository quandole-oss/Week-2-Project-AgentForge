export interface AiAgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AiAgentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface AiAgentToolCall {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs?: number;
}

export interface AiAgentResponse {
  message: AiAgentMessage;
  traceId?: string;
  toolCalls?: AiAgentToolCall[];
  confidence?: number;
  disclaimer: string;
  disclaimers?: string[];
  sources: { service: string; timestamp: string }[];
  usage?: AiAgentUsage;
  durationMs?: number;
}
