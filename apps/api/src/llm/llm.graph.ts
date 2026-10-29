/*
 * @Date: 2026-10-27 15:05:25
 * @LastEditors: shiyu 625991037@qq.com
 * @LastEditTime: 2026-10-29 13:57:04
 * @FilePath: /clothesShoppingGuide/apps/api/src/llm/llm.graph.ts
 * @Description:
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ClientTool } from '@langchain/core/tools';
import { END, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';

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

export type LlmTool = ClientTool;

function routeAfterChatModel(state: LlmStateValue): 'tools' | typeof END {
  const lastMessage = state.messages.at(-1);
  const toolCalls = asRecord(lastMessage).tool_calls;

  return Array.isArray(toolCalls) && toolCalls.length > 0 ? 'tools' : END;
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

export function createLlmGraph(model: BaseChatModel, tools: LlmTool[] = []) {
  const modelWithTools =
    tools.length > 0
      ? model.bindTools
        ? model.bindTools(tools)
        : (() => {
            throw new Error('当前 Chat Model 不支持工具调用');
          })()
      : model;

  const chatModelNode = async (
    state: LlmStateValue,
  ): Promise<LlmStateUpdate> => {
    // 模型节点只负责决策；工具执行交给 LangGraph 官方 ToolNode。
    const response = await modelWithTools.invoke(state.messages);
    const usage = normalizeUsage(response);
    return usage ? { messages: [response], usage } : { messages: [response] };
  };

  return new StateGraph(LlmState)
    .addNode('chatModel', chatModelNode)
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'chatModel')
    .addConditionalEdges('chatModel', routeAfterChatModel, ['tools', END])
    .addEdge('tools', 'chatModel')
    .compile();
}
