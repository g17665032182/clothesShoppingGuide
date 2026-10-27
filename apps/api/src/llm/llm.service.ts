import {
  BadGatewayException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';

import { ChatMessageRole } from './dto/chat.dto.js';
import { LLM_GRAPH } from './llm.tokens.js';
import type { LlmStateValue, LlmUsage } from './llm.state.js';

export type ChatInput = {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
};

export type ChatOutput = {
  content: string;
  model: string;
  usage: LlmUsage | null;
};

export type LlmGraph = {
  invoke(input: { messages: BaseMessage[] }): Promise<LlmStateValue>;
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
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        const record = asRecord(part);
        return typeof record.text === 'string' ? record.text : '';
      })
      .join('');
    if (text.length > 0) {
      return text;
    }
  }

  throw new BadGatewayException('上游大模型返回内容无法解析');
}

function toLangChainMessage(
  message: ChatInput['messages'][number],
): BaseMessage {
  switch (message.role) {
    case ChatMessageRole.SYSTEM:
      return new SystemMessage(message.content);
    case ChatMessageRole.ASSISTANT:
      return new AIMessage(message.content);
    case ChatMessageRole.USER:
    default:
      return new HumanMessage(message.content);
  }
}

@Injectable()
export class LlmService {
  public constructor(
    @Inject(LLM_GRAPH) private readonly graph: LlmGraph,
    private readonly configService: ConfigService,
  ) {}

  public async chat(input: ChatInput): Promise<ChatOutput> {
    const model = this.configService.get<string>('LLM_MODEL')?.trim();
    if (!model) {
      throw new ServiceUnavailableException('大模型服务尚未完成配置');
    }

    let result: LlmStateValue;
    try {
      result = await this.graph.invoke({
        messages: input.messages.map(toLangChainMessage),
      });
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
      usage: result.usage ?? null,
    };
  }

  private rethrowMappedError(error: unknown): never {
    if (isTimeoutError(error)) {
      throw new GatewayTimeoutException('大模型调用超时');
    }
    throw new BadGatewayException('上游大模型调用失败');
  }
}
