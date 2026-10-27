import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { END, START, StateGraph } from '@langchain/langgraph';

import {
  LlmState,
  type LlmStateUpdate,
  type LlmStateValue,
  type LlmUsage,
} from './llm.state.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickNumber(source: UnknownRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(source[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/**
 * 将不同供应商的 token 字段归一化为模块自己的响应结构。
 * 不根据文本长度估算 token，缺失字段统一返回 null。
 */
export function normalizeUsage(message: BaseMessage): LlmUsage | undefined {
  const messageRecord = asRecord(message);
  const usageMetadata = asRecord(messageRecord.usage_metadata);
  const responseMetadata = asRecord(messageRecord.response_metadata);
  const tokenUsage = asRecord(responseMetadata.tokenUsage);
  const source =
    Object.keys(usageMetadata).length > 0 ? usageMetadata : tokenUsage;
  const usage = {
    inputTokens: pickNumber(source, [
      'input_tokens',
      'inputTokens',
      'prompt_tokens',
      'promptTokens',
    ]),
    outputTokens: pickNumber(source, [
      'output_tokens',
      'outputTokens',
      'completion_tokens',
      'completionTokens',
    ]),
    totalTokens: pickNumber(source, ['total_tokens', 'totalTokens']),
  };

  return Object.values(usage).some((value) => value !== null)
    ? usage
    : undefined;
}

export function createLlmGraph(model: BaseChatModel) {
  const chatModelNode = async (
    state: LlmStateValue,
  ): Promise<LlmStateUpdate> => {
    // 当前节点只负责调用模型，业务判断留给后续独立节点。
    const response = await model.invoke(state.messages);
    const usage = normalizeUsage(response);
    return usage ? { messages: [response], usage } : { messages: [response] };
  };

  return new StateGraph(LlmState)
    .addNode('chatModel', chatModelNode)
    .addEdge(START, 'chatModel')
    .addEdge('chatModel', END)
    .compile();
}
