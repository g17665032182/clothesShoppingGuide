import {
  BadGatewayException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';

import { ChatMessageRole } from '../dto/chat.dto.js';
import {
  createLlmGraph,
  normalizeUsage,
  type LlmTool,
} from '../graph/llm.graph.js';
import { LLM_GRAPH, LLM_GRAPH_FACTORY } from '../graph/llm.tokens.js';
import type { LlmStateValue, LlmUsage } from '../graph/llm.state.js';
import type { LlmTraceContext } from '../trace/llm-trace.types.js';
import { SYSTEM_CONTEXT } from '../context/system-context.js';
import { visibleMessageContent } from '../stream/llm-visible-content.js';
import {
  isStreamEnvelope,
  LlmStreamLifecycle,
} from '../stream/llm-stream-envelope.js';
import type {
  LlmEventStreamResult,
  LlmStreamEvent,
} from '../stream/llm-stream.types.js';

export type UserChatInput = {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
};

export type ChatInput = {
  messages: Array<
    | BaseMessage
    | {
        role: 'system' | 'user' | 'assistant';
        content: string;
      }
  >;
};

export type LlmExecutionOptions = {
  traceSequence?: number;
  skipPersistInput?: boolean;
  ephemeralModelMessages?: BaseMessage[];
};

export type ChatOutput = {
  content: string;
  model: string;
  usage: LlmUsage | null;
  /** 内部展示绑定使用，HTTP 响应必须显式剔除。 */
  finalTraceSequence?: number | null;
};

export type LlmGraph = ReturnType<typeof createLlmGraph>;
export type LlmGraphFactory = (extraTools: LlmTool[]) => LlmGraph;

export type LlmStreamResult = {
  content: string;
  model: string;
  usage: LlmUsage | null;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : {};
}

function isTimeoutError(error: unknown): boolean {
  const record = asRecord(error);
  const name = typeof record.name === 'string' ? record.name : '';
  const code = typeof record.code === 'string' ? record.code : '';
  const message = error instanceof Error ? error.message : '';
  return (
    name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    /timeout|timed out|超时/i.test(message)
  );
}

function normalizeContent(content: unknown): string {
  const text = visibleMessageContent(content);
  if (text || typeof content === 'string') return text;
  throw new BadGatewayException('上游大模型返回内容无法解析');
}

function toLangChainMessage(
  message: ChatInput['messages'][number],
): BaseMessage {
  if (message instanceof BaseMessage) {
    return message;
  }
  switch (message.role) {
    case 'system':
      return new SystemMessage(message.content);
    case ChatMessageRole.ASSISTANT:
      return new AIMessage(message.content);
    case ChatMessageRole.USER:
    default:
      return new HumanMessage(message.content);
  }
}

function toUserMessage(
  message: UserChatInput['messages'][number],
): BaseMessage {
  return message.role === ChatMessageRole.ASSISTANT
    ? new AIMessage(message.content)
    : new HumanMessage(message.content);
}

@Injectable()
export class LlmService {
  public constructor(
    @Inject(LLM_GRAPH) private readonly graph: LlmGraph,
    private readonly configService: ConfigService,
    @Optional()
    @Inject(LLM_GRAPH_FACTORY)
    private readonly graphFactory?: LlmGraphFactory,
  ) {}

  public async chat(
    input: UserChatInput,
    traceContext?: LlmTraceContext,
  ): Promise<ChatOutput> {
    return this.chatPrepared(
      {
        messages: [
          new SystemMessage(SYSTEM_CONTEXT),
          ...input.messages.map(toUserMessage),
        ],
      },
      traceContext,
    );
  }

  public async chatPrepared(
    input: ChatInput,
    traceContext?: LlmTraceContext,
    extraTools: LlmTool[] = [],
    execution: LlmExecutionOptions = {},
  ): Promise<ChatOutput> {
    const model = this.assertConfigured();

    let result: LlmStateValue;
    try {
      result = await this.activeGraph(extraTools).invoke(
        {
          messages: input.messages.map(toLangChainMessage),
          ...(execution.traceSequence === undefined
            ? {}
            : { traceSequence: execution.traceSequence }),
        },
        traceContext || Object.keys(execution).length > 0
          ? {
              context: {
                ...traceContext,
                ...(execution.skipPersistInput
                  ? { skipPersistInput: true }
                  : {}),
                ...(execution.ephemeralModelMessages
                  ? {
                      ephemeralModelMessages: execution.ephemeralModelMessages,
                    }
                  : {}),
              } as any,
            }
          : undefined,
      );
    } catch (error) {
      this.rethrowMappedError(error);
      throw new BadGatewayException('上游大模型调用失败');
    }

    const response = result.messages.at(-1);
    if (!response || !(response instanceof BaseMessage)) {
      throw new BadGatewayException('上游大模型返回内容无法解析');
    }

    return {
      content: normalizeContent(response.content),
      model,
      usage: normalizeUsage(response) ?? null,
      ...(traceContext
        ? { finalTraceSequence: result.finalTraceSequence ?? null }
        : {}),
    };
  }

  public async *stream(
    input: UserChatInput,
    signal?: AbortSignal,
    traceContext?: LlmTraceContext,
  ): AsyncGenerator<string, LlmStreamResult> {
    return yield* this.streamPrepared(
      {
        messages: [
          new SystemMessage(SYSTEM_CONTEXT),
          ...input.messages.map(toUserMessage),
        ],
      },
      signal,
      traceContext,
    );
  }

  public async *streamPrepared(
    input: ChatInput,
    signal?: AbortSignal,
    traceContext?: LlmTraceContext,
  ): AsyncGenerator<string, LlmStreamResult> {
    const events = this.streamEventsPrepared(input, signal, traceContext);
    try {
      while (true) {
        const next = await events.next();
        if (next.done) {
          const { content, model, usage } = next.value;
          return { content, model, usage };
        }
        if (next.value.type === 'delta') yield next.value.content;
      }
    } finally {
      await events.return(undefined as never);
    }
  }

  public async *streamEventsPrepared(
    input: ChatInput,
    signal?: AbortSignal,
    traceContext?: LlmTraceContext,
    extraTools: LlmTool[] = [],
    execution: LlmExecutionOptions = {},
  ): AsyncGenerator<LlmStreamEvent, LlmEventStreamResult> {
    const model = this.assertConfigured();
    const controller = new AbortController();
    const lifecycle = new LlmStreamLifecycle();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let iterator: AsyncIterator<[string, unknown]> | undefined;
    let fullMessage: BaseMessage | undefined;
    let finalTraceSequence: number | null = null;
    let content = '';
    try {
      controller.signal.throwIfAborted();
      const stream = await this.activeGraph(extraTools).stream(
        {
          messages: input.messages.map(toLangChainMessage),
          ...(execution.traceSequence === undefined
            ? {}
            : { traceSequence: execution.traceSequence }),
        },
        {
          streamMode: ['custom', 'values'],
          signal: controller.signal,
          context: {
            ...traceContext,
            streaming: true,
            eventStreaming: true,
            streamLifecycle: lifecycle,
            signal: controller.signal,
            ...(execution.skipPersistInput ? { skipPersistInput: true } : {}),
            ...(execution.ephemeralModelMessages
              ? {
                  ephemeralModelMessages: execution.ephemeralModelMessages,
                }
              : {}),
          } as any,
        },
      );
      iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        controller.signal.throwIfAborted();
        const [mode, value] = next.value;
        if (mode === 'custom' && isStreamEnvelope(value)) {
          if (value.event.type === 'delta') content += value.event.content;
          yield value.event;
          // HTTP 调用方完成本次写入并继续拉取后，才允许模型继续生产。
          value.acknowledge();
          continue;
        }
        if (mode !== 'values') continue;
        const state = value as LlmStateValue;
        finalTraceSequence = state.finalTraceSequence ?? null;
        const response = state.messages.at(-1);
        if (!response || response.type !== 'ai') continue;
        const toolCalls = asRecord(response).tool_calls;
        const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
        if (!hasToolCalls) fullMessage = response;
      }
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error;
      }
      this.rethrowMappedError(error);
    } finally {
      // return() 同样取消正在等待确认的节点，避免关闭流时互相等待。
      controller.abort();
      signal?.removeEventListener('abort', abort);
      try {
        await iterator?.return?.();
      } finally {
        await lifecycle.waitForIdle();
      }
    }

    if (!fullMessage || !content.trim()) {
      throw new BadGatewayException('上游大模型未返回内容');
    }

    return {
      content,
      model,
      usage: normalizeUsage(fullMessage) ?? null,
      finalTraceSequence,
    };
  }

  public createSystemContextMessage(): SystemMessage {
    return new SystemMessage(SYSTEM_CONTEXT);
  }

  public async chatInternal(input: ChatInput): Promise<ChatOutput> {
    return this.chatPrepared(input);
  }

  public assertConfigured(): string {
    const model = this.configService.get<string>('LLM_MODEL')?.trim();
    if (!model) {
      throw new ServiceUnavailableException('大模型服务尚未完成配置');
    }
    return model;
  }

  private rethrowMappedError(error: unknown): never {
    if (isTimeoutError(error)) {
      throw new GatewayTimeoutException('大模型调用超时');
    }
    throw new BadGatewayException('上游大模型调用失败');
  }

  private activeGraph(extraTools: LlmTool[]): LlmGraph {
    if (extraTools.length === 0) return this.graph;
    if (!this.graphFactory) {
      throw new ServiceUnavailableException('本次聊天工具未完成配置');
    }
    return this.graphFactory(extraTools);
  }
}
