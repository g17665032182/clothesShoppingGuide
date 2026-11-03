import type { LlmUsage } from '../graph/llm.state.js';

/** 模块内部事件只供运行编排使用，必须经过公开投影才能进入 HTTP 响应。 */
export type LlmStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool-call'; id: string; toolName: string; input: unknown }
  | {
      type: 'tool-result';
      id: string;
      toolName: string;
      status: 'success' | 'error';
      output: string;
    }
  | { type: 'reasoning'; id: string; summary: string }
  | {
      type: 'sources';
      sources: Array<{ id: string; title: string; url: string }>;
    };

export type LlmEventStreamResult = {
  content: string;
  model: string;
  usage: LlmUsage | null;
  finalTraceSequence: number | null;
};
