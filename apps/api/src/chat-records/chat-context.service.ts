import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getEncoding } from 'js-tiktoken';

import type { ChatInput } from '../llm/llm.service.js';
import type { ChatMessage } from './chat-message.entity.js';

export type ContextPlan = {
  messages: ChatInput['messages'];
  needsSummary: boolean;
  summarySource: ChatMessage[];
  lastIncludedMessageId: string | null;
  hardLimit: number;
};

@Injectable()
export class ChatContextService {
  public constructor(private readonly configService: ConfigService) {}

  public prepare(input: {
    history: ChatMessage[];
    currentUserMessage: string;
    systemMessages: ChatInput['messages'];
    contextSummary?: string | null | undefined;
    summaryThroughMessageId?: string | null | undefined;
  }): ContextPlan {
    const window = this.getContextWindow();
    const inputBudget = Math.floor(window * 0.8);
    const trigger = Math.floor(inputBudget * 0.75);
    const hardLimit = Math.floor(inputBudget * 0.9);
    const recentBudget = Math.floor(inputBudget * 0.3);
    const system = input.systemMessages.filter(
      (message) => message.role === 'system',
    );
    const current: ChatInput['messages'][number] = {
      role: 'user',
      content: input.currentUserMessage,
    };
    const allHistory = input.history;
    const allMessages = [
      ...system,
      ...allHistory.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      current,
    ];

    if (this.countTokens(allMessages) <= trigger) {
      return {
        messages: allMessages,
        needsSummary: false,
        summarySource: [],
        lastIncludedMessageId: allHistory.at(-1)?.id ?? null,
        hardLimit,
      };
    }

    const recent: ChatMessage[] = [];
    let recentTokens = this.countTokens([current]);
    for (let index = allHistory.length - 1; index >= 0; index -= 1) {
      const candidate = allHistory[index];
      if (!candidate) {
        continue;
      }
      const candidateTokens = this.countTokens([
        { role: candidate.role, content: candidate.content },
      ]);
      if (recent.length > 0 && recentTokens + candidateTokens > recentBudget) {
        break;
      }
      recent.unshift(candidate);
      recentTokens += candidateTokens;
    }

    const coveredIndex = input.summaryThroughMessageId
      ? allHistory.findIndex(
          (message) => message.id === input.summaryThroughMessageId,
        )
      : -1;
    const firstRecentIndex =
      recent.length > 0 && recent[0]
        ? allHistory.indexOf(recent[0])
        : allHistory.length;
    const summarySource = allHistory
      .slice(coveredIndex + 1, firstRecentIndex)
      .filter(
        (message) => message.role === 'user' || message.role === 'assistant',
      );

    const messages: ChatInput['messages'] = [
      ...system,
      ...(input.contextSummary
        ? [
            {
              role: 'user' as const,
              content: `[历史摘要]\n${input.contextSummary}`,
            },
          ]
        : []),
      ...recent.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      current,
    ];

    while (this.countTokens(messages) > hardLimit && messages.length > 1) {
      const removableIndex = messages.findIndex(
        (message) => message.role !== 'system' && message !== current,
      );
      if (removableIndex < 0) {
        break;
      }
      messages.splice(removableIndex, 1);
    }

    return {
      messages,
      needsSummary: summarySource.length > 0,
      summarySource,
      lastIncludedMessageId:
        summarySource.at(-1)?.id ?? input.summaryThroughMessageId ?? null,
      hardLimit,
    };
  }

  public countTokens(messages: ChatInput['messages']): number {
    const encodingName =
      this.configService.get<string>('LLM_TOKEN_ENCODING')?.trim() ||
      'cl100k_base';
    let encoder: ReturnType<typeof getEncoding> | undefined;
    try {
      encoder = getEncoding(encodingName as Parameters<typeof getEncoding>[0]);
      return messages.reduce(
        (total, message) => total + encoder!.encode(message.content).length + 4,
        0,
      );
    } catch {
      throw new ServiceUnavailableException('LLM_TOKEN_ENCODING 配置无效');
    } finally {
    }
  }

  public truncateToTokens(content: string, maxTokens: number): string {
    const encodingName =
      this.configService.get<string>('LLM_TOKEN_ENCODING')?.trim() ||
      'cl100k_base';
    let encoder: ReturnType<typeof getEncoding> | undefined;
    try {
      encoder = getEncoding(encodingName as Parameters<typeof getEncoding>[0]);
      return encoder.decode(encoder.encode(content).slice(0, maxTokens));
    } catch {
      throw new ServiceUnavailableException('LLM_TOKEN_ENCODING 配置无效');
    }
  }

  private getContextWindow(): number {
    const value = Number(
      this.configService.get<string>('LLM_CONTEXT_WINDOW_TOKENS'),
    );
    if (!Number.isInteger(value) || value <= 0) {
      throw new ServiceUnavailableException(
        'LLM_CONTEXT_WINDOW_TOKENS 配置无效',
      );
    }
    return value;
  }
}
