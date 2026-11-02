import { Inject, Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { LLM_CHAT_MODEL } from '../graph/llm.tokens.js';
import { LLM_MODEL_NAME } from './structured-text-generation.tokens.js';
import {
  StructuredTextGenerationError,
  type StructuredTextGenerationPort,
  type StructuredTextGenerationResult,
} from './structured-text-generation.port.js';

type UnknownRecord = Record<string, unknown>;

@Injectable()
export class StructuredTextGenerationService implements StructuredTextGenerationPort {
  public constructor(
    @Inject(LLM_CHAT_MODEL) private readonly model: BaseChatModel,
    @Inject(LLM_MODEL_NAME) private readonly modelName: string,
  ) {}

  public async generate(input: {
    system: string;
    user: string;
    timeoutMs: number;
  }): Promise<StructuredTextGenerationResult> {
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new StructuredTextGenerationError('MODEL_UNAVAILABLE');
    }

    try {
      const response = await this.model.invoke(
        [new SystemMessage(input.system), new HumanMessage(input.user)],
        { signal: AbortSignal.timeout(input.timeoutMs) },
      );
      const content = this.toText(response.content);
      if (!content) {
        throw new StructuredTextGenerationError('INVALID_OUTPUT');
      }
      return { model: this.modelName, content };
    } catch (error) {
      if (error instanceof StructuredTextGenerationError) throw error;
      if (this.isTimeout(error)) {
        throw new StructuredTextGenerationError('MODEL_TIMEOUT');
      }
      throw new StructuredTextGenerationError('MODEL_UNAVAILABLE');
    }
  }

  private toText(content: unknown): string {
    if (typeof content === 'string') return content.trim();
    if (!Array.isArray(content)) return '';
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const value = this.asRecord(part);
        return typeof value.text === 'string' ? value.text : '';
      })
      .join('')
      .trim();
  }

  private isTimeout(error: unknown): boolean {
    const value = this.asRecord(error);
    const name = typeof value.name === 'string' ? value.name : '';
    const code = typeof value.code === 'string' ? value.code : '';
    return (
      name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT'
    );
  }

  private asRecord(value: unknown): UnknownRecord {
    return typeof value === 'object' && value !== null
      ? (value as UnknownRecord)
      : {};
  }
}
