import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import {
  AIMessage,
  AIMessageChunk,
  type ToolCall,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { UsageMetadata } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';

export type FakeChatModelOptions = {
  response?: string;
  responses?: Array<{
    response: string;
    toolCalls?: ToolCall[];
  }>;
  chunks?: string[];
  usage?: UsageMetadata;
  responseMetadata?: Record<string, unknown>;
  error?: Error;
  streamError?: Error;
  delayMs?: number;
};

/**
 * 用于自动化测试的本地 Chat Model，不会访问外部网络。
 * 通过记录调用消息和可控错误，覆盖 Graph、Service 的关键行为。
 */
export class FakeChatModel extends BaseChatModel {
  public readonly calls: BaseMessage[][] = [];

  private readonly response: string;
  private readonly responses: Array<{
    response: string;
    toolCalls?: ToolCall[];
  }>;
  private readonly chunks: string[];
  private readonly usage?: FakeChatModelOptions['usage'];
  private readonly responseMetadata: Record<string, unknown> | undefined;
  private readonly error: Error | undefined;
  private readonly streamError: Error | undefined;
  private readonly delayMs: number;

  public constructor(options: FakeChatModelOptions = {}) {
    super({});
    this.response = options.response ?? 'fake response';
    this.responses = options.responses ? [...options.responses] : [];
    this.chunks = options.chunks ?? [this.response];
    this.usage = options.usage;
    this.responseMetadata = options.responseMetadata;
    this.error = options.error;
    this.streamError = options.streamError;
    this.delayMs = options.delayMs ?? 0;
  }

  public bindTools(_tools: unknown[]): this {
    return this;
  }

  public _llmType(): string {
    return 'fake-chat-model';
  }

  public async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.calls.push(messages);

    if (this.delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.delayMs);
      });
    }

    if (this.error) {
      throw this.error;
    }

    const scriptedResponse = this.responses.shift();
    const message = new AIMessage({
      content: scriptedResponse?.response ?? this.response,
      ...(scriptedResponse?.toolCalls
        ? { tool_calls: scriptedResponse.toolCalls }
        : {}),
    });
    if (this.usage) {
      // 默认 AIMessage 泛型未声明 usage_metadata，测试替身在这里补充供应商元数据。
      (
        message as unknown as { usage_metadata?: UsageMetadata }
      ).usage_metadata = this.usage;
    }
    if (this.responseMetadata) {
      message.response_metadata = this.responseMetadata;
    }

    return {
      generations: [
        {
          text: typeof message.content === 'string' ? message.content : '',
          message,
        },
      ],
    };
  }

  public async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    this.calls.push(messages);

    for (const [index, chunk] of this.chunks.entries()) {
      if (this.delayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, this.delayMs);
        });
      }

      if (index === this.chunks.length - 1 && this.streamError) {
        throw this.streamError;
      }

      const message = new AIMessageChunk(chunk);
      if (index === this.chunks.length - 1 && this.usage) {
        (
          message as unknown as { usage_metadata?: UsageMetadata }
        ).usage_metadata = this.usage;
      }
      if (index === this.chunks.length - 1 && this.responseMetadata) {
        message.response_metadata = this.responseMetadata;
      }
      yield new ChatGenerationChunk({
        text: chunk,
        message,
      });
    }
  }
}
