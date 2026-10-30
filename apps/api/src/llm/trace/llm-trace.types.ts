import type { LlmUsage } from '../graph/llm.state.js';

export type LlmTraceWriteContext = {
  conversationId: string;
  runId: string;
};

export type LlmTraceEvent =
  | {
      sequence: number;
      type: 'input';
      messageId: string | null;
      content: string;
    }
  | {
      sequence: number;
      type: 'model_response';
      messageId: string | null;
      content: string;
      model: string | null;
      usage: LlmUsage | null;
      payload?: unknown;
    }
  | {
      sequence: number;
      type: 'tool_call';
      messageId: string | null;
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      sequence: number;
      type: 'tool_result';
      messageId: string | null;
      toolCallId: string;
      toolName: string | null;
      content: string;
      status: 'success' | 'failed';
      payload?: unknown;
    };

export interface LlmTraceWriter {
  writeEvents(
    context: LlmTraceWriteContext,
    events: LlmTraceEvent[],
  ): Promise<void>;
}

export type LlmTraceContext = LlmTraceWriteContext & {
  writer: LlmTraceWriter;
  model?: string;
  signal?: AbortSignal;
  streaming?: boolean;
};
