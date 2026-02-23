export interface AiAgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AiAgentResponse {
  message: AiAgentMessage;
  toolCalls?: {
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
  }[];
  confidence?: number;
  disclaimer: string;
  sources: { service: string; timestamp: string }[];
}
