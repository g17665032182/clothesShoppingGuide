/*
 * @Date: 2026-10-27 15:05:25
 * @LastEditors: shiyu 625991037@qq.com
 * @LastEditTime: 2026-10-29 13:57:04
 * @FilePath: /clothesShoppingGuide/apps/api/src/llm/graph/llm.graph.ts
 * @Description:
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  ToolMessage,
  type BaseMessageChunk,
} from '@langchain/core/messages';
import type { ClientTool } from '@langchain/core/tools';
import {
  END,
  START,
  StateGraph,
  StateSchema,
  type Runtime,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';

import {
  LlmState,
  type LlmStateUpdate,
  type LlmStateValue,
  type LlmUsage,
} from './llm.state.js';
import type {
  LlmTraceContext,
  LlmTraceEvent,
} from '../trace/llm-trace.types.js';
import { visibleMessageContent } from '../stream/llm-visible-content.js';
import {
  writeStreamEvent,
  type LlmStreamLifecycle,
} from '../stream/llm-stream-envelope.js';
import type { LlmStreamEvent } from '../stream/llm-stream.types.js';

type UnknownRecord = Record<string, unknown>;
export type GraphTraceContext = {
  conversationId?: string;
  runId?: string;
  writer?: LlmTraceContext['writer'];
  model?: string;
  signal?: AbortSignal;
  streaming?: boolean;
  eventStreaming?: boolean;
  streamLifecycle?: LlmStreamLifecycle;
};

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
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

const LlmTraceContextSchema = new StateSchema({
  conversationId: z.string().optional(),
  runId: z.string().optional(),
  writer: z.custom<LlmTraceContext['writer']>().optional(),
  model: z.string().optional(),
  signal: z.custom<AbortSignal>().optional(),
  streaming: z.boolean().optional(),
  eventStreaming: z.boolean().optional(),
  streamLifecycle: z.custom<LlmStreamLifecycle>().optional(),
});

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

function messageId(message: BaseMessage): string | null {
  return typeof message.id === 'string' && message.id.length > 0
    ? message.id
    : null;
}

function toolCalls(message: BaseMessage): Array<{
  id: string | undefined;
  name: string | undefined;
  args: unknown;
}> {
  const calls = asRecord(message).tool_calls;
  return Array.isArray(calls)
    ? calls.map((call) => {
        const value = asRecord(call);
        return {
          id: typeof value.id === 'string' ? value.id : undefined,
          name: typeof value.name === 'string' ? value.name : undefined,
          args: value.args,
        };
      })
    : [];
}

const normalizeMessageContent = visibleMessageContent;

async function emitEvent(
  runtime: Runtime<Record<string, unknown>>,
  event: LlmStreamEvent,
): Promise<void> {
  const context = runtime.context as GraphTraceContext | undefined;
  if (!context?.eventStreaming) return;
  await writeStreamEvent(
    runtime.writer,
    event,
    context.signal ?? runtime.signal,
  );
}

function toAiMessage(chunk: AIMessageChunk): AIMessage {
  const record = asRecord(chunk);
  return new AIMessage({
    content: chunk.content,
    additional_kwargs: chunk.additional_kwargs,
    response_metadata: chunk.response_metadata,
    id: chunk.id,
    ...(Array.isArray(record.tool_calls)
      ? { tool_calls: record.tool_calls }
      : {}),
    ...(Array.isArray(record.invalid_tool_calls)
      ? { invalid_tool_calls: record.invalid_tool_calls }
      : {}),
    ...(record.usage_metadata &&
    typeof record.usage_metadata === 'object' &&
    'input_tokens' in record.usage_metadata
      ? {
          usage_metadata:
            record.usage_metadata as unknown as AIMessage['usage_metadata'],
        }
      : {}),
  } as ConstructorParameters<typeof AIMessage>[0]);
}

async function writeTraceEvents(
  runtime: Runtime<Record<string, unknown>>,
  events: LlmTraceEvent[],
): Promise<void> {
  const context = runtime.context as unknown as GraphTraceContext | undefined;
  if (
    !context?.writer ||
    !context.conversationId ||
    !context.runId ||
    events.length === 0
  )
    return;
  await context.writer.writeEvents(
    {
      conversationId: context.conversationId,
      runId: context.runId,
    },
    events,
  );
}

function nextSequence(state: LlmStateValue): number {
  return state.traceSequence ?? 0;
}

function lastToolMessages(messages: BaseMessage[]): ToolMessage[] {
  const result: ToolMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof ToolMessage)) break;
    result.unshift(message);
  }
  return result;
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

  const persistInput = async (
    state: LlmStateValue,
    runtime: Runtime<Record<string, unknown>>,
  ): Promise<LlmStateUpdate> => {
    const input = [...state.messages]
      .reverse()
      .find((message) => message.type === 'human');
    if (!input) return {};
    const sequence = nextSequence(state);
    await writeTraceEvents(runtime, [
      {
        sequence,
        type: 'input',
        messageId: messageId(input),
        content: normalizeMessageContent(input.content),
      },
    ]);
    return { traceSequence: sequence + 1 };
  };

  const chatModelNode = async (
    state: LlmStateValue,
    runtime: Runtime<Record<string, unknown>>,
  ): Promise<LlmStateUpdate> => {
    const context = runtime.context as unknown as GraphTraceContext | undefined;
    // 正文增量立即发送；工具参数仍聚合为完整消息后才进入工具节点。
    if (context?.streaming) {
      const finish = context.streamLifecycle?.begin();
      try {
        let aggregate: AIMessageChunk | undefined;
        const stream = (await modelWithTools.stream(
          state.messages,
          context.signal ? { signal: context.signal } : undefined,
        )) as AsyncIterable<BaseMessageChunk>;
        for await (const rawChunk of stream) {
          if (context.signal?.aborted) {
            throw new DOMException('The operation was aborted', 'AbortError');
          }
          const aiChunk = AIMessageChunk.isInstance(rawChunk)
            ? rawChunk
            : new AIMessageChunk({
                content: rawChunk.content,
                additional_kwargs: rawChunk.additional_kwargs,
                response_metadata: rawChunk.response_metadata,
              });
          aggregate = aggregate ? aggregate.concat(aiChunk) : aiChunk;
          const content = visibleMessageContent(aiChunk.content);
          if (content) await emitEvent(runtime, { type: 'delta', content });
        }
        if (!aggregate) {
          throw new Error('上游大模型未返回内容');
        }
        const response = toAiMessage(aggregate);
        const usage = normalizeUsage(response);
        return { messages: [response], usage };
      } finally {
        finish?.();
      }
    }

    // 非流式路径保持 invoke，兼容不实现 _streamResponseChunks 的模型。
    const response = await modelWithTools.invoke(state.messages);
    const usage = normalizeUsage(response);
    return { messages: [response], usage };
  };

  const persistModelEvent = async (
    state: LlmStateValue,
    runtime: Runtime<Record<string, unknown>>,
  ): Promise<LlmStateUpdate> => {
    const context = runtime.context as unknown as GraphTraceContext | undefined;
    const response = state.messages.at(-1);
    if (!response || response.type !== 'ai') return {};
    const calls = toolCalls(response);
    if (
      (Array.isArray(asRecord(response).invalid_tool_calls) &&
        (asRecord(response).invalid_tool_calls as unknown[]).length > 0) ||
      calls.some((call) => !call.id || !call.name)
    ) {
      throw new Error('上游工具调用参数无效');
    }
    let sequence = nextSequence(state);
    const modelSequence = sequence;
    const events: LlmTraceEvent[] = [
      {
        sequence,
        type: 'model_response',
        messageId: messageId(response),
        content: normalizeMessageContent(response.content),
        model: context?.model ?? null,
        usage: normalizeUsage(response) ?? null,
      },
    ];
    sequence += 1;
    for (const call of calls) {
      if (!call.id || !call.name) continue;
      events.push({
        sequence,
        type: 'tool_call',
        messageId: messageId(response),
        toolCallId: call.id,
        toolName: call.name,
        args: call.args ?? {},
      });
      sequence += 1;
    }
    await writeTraceEvents(runtime, events);
    for (const call of calls) {
      await emitEvent(runtime, {
        type: 'tool-call',
        id: call.id!,
        toolName: call.name!,
        input: call.args ?? {},
      });
    }
    return {
      traceSequence: sequence,
      finalTraceSequence:
        context?.writer && context.conversationId && context.runId
          ? modelSequence
          : null,
    };
  };

  const persistToolEvent = async (
    state: LlmStateValue,
    runtime: Runtime<Record<string, unknown>>,
  ): Promise<LlmStateUpdate> => {
    const messages = lastToolMessages(state.messages);
    if (messages.length === 0) return {};
    let sequence = nextSequence(state);
    const previousCalls = state.messages
      .filter((message) => message.type === 'ai')
      .at(-1);
    const calls = previousCalls ? toolCalls(previousCalls) : [];
    const events: LlmTraceEvent[] = messages.map((message) => {
      const call = calls.find((item) => item.id === message.tool_call_id);
      const event: LlmTraceEvent = {
        sequence: sequence++,
        type: 'tool_result',
        messageId: messageId(message),
        toolCallId: message.tool_call_id,
        toolName: call?.name ?? message.name ?? null,
        content: normalizeMessageContent(message.content),
        status: message.status === 'error' ? 'failed' : 'success',
      };
      return event;
    });
    await writeTraceEvents(runtime, events);
    for (const event of events) {
      if (event.type !== 'tool_result') continue;
      await emitEvent(runtime, {
        type: 'tool-result',
        id: event.toolCallId,
        toolName: event.toolName ?? '',
        status: event.status === 'failed' ? 'error' : 'success',
        output: event.content,
      });
    }
    if (messages.some((message) => message.status === 'error')) {
      throw new Error('工具执行失败');
    }
    return { traceSequence: sequence };
  };

  return new StateGraph(LlmState, LlmTraceContextSchema)
    .addNode('persistInput', persistInput)
    .addNode('chatModel', chatModelNode)
    .addNode('persistModelEvent', persistModelEvent)
    .addNode('tools', new ToolNode(tools))
    .addNode('persistToolEvent', persistToolEvent)
    .addEdge(START, 'persistInput')
    .addEdge('persistInput', 'chatModel')
    .addEdge('chatModel', 'persistModelEvent')
    .addConditionalEdges('persistModelEvent', routeAfterChatModel, [
      'tools',
      END,
    ])
    .addEdge('tools', 'persistToolEvent')
    .addEdge('persistToolEvent', 'chatModel')
    .compile();
}
