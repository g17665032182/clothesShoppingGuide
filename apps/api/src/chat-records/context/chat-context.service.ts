import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { getEncoding } from 'js-tiktoken';

import type { ChatInput } from '../../llm/service/llm.service.js';
import { LlmService } from '../../llm/service/llm.service.js';
import type { ChatHistoryMessage } from '../history/chat-history.mapper.js';
import type { ChatMessage } from '../entity/chat-message.entity.js';

export type ContextPlan = {
  messages: BaseMessage[];
  needsSummary: boolean;
  summarySource: ChatMessage[];
  messageSummarySource?: ChatHistoryMessage[];
  lastIncludedMessageId: string | null;
  hardLimit: number;
};

type MessageGroup = {
  items: ChatHistoryMessage[];
  tokens: number;
};

function messageText(message: BaseMessage): string {
  const parts = [
    typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content),
  ];
  if (message instanceof AIMessage && message.tool_calls?.length) {
    parts.push(JSON.stringify(message.tool_calls));
  }
  if (message instanceof ToolMessage) {
    parts.push(message.tool_call_id);
  }
  return parts.join('\n');
}

function toLegacyHistory(history: ChatMessage[]): ChatHistoryMessage[] {
  return history.map((item) => ({
    id: item.id,
    message:
      item.role === 'user'
        ? new HumanMessage({ content: item.content, id: item.id })
        : new AIMessage({ content: item.content, id: item.id }),
  }));
}

function completeMessageGroups(history: ChatHistoryMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const current = history[index];
    if (!current || current.message instanceof ToolMessage) {
      continue;
    }

    const items = [current];
    if (
      current.message instanceof AIMessage &&
      current.message.tool_calls?.length
    ) {
      const pending = new Set(
        current.message.tool_calls.flatMap((call) =>
          call.id ? [call.id] : [],
        ),
      );
      let cursor = index + 1;
      while (cursor < history.length && pending.size > 0) {
        const candidate = history[cursor];
        if (!candidate || !(candidate.message instanceof ToolMessage)) {
          break;
        }
        items.push(candidate);
        pending.delete(candidate.message.tool_call_id);
        cursor += 1;
      }
      if (pending.size > 0) {
        continue;
      }
      index = cursor - 1;
    }

    groups.push({
      items,
      tokens: items.reduce(
        (total, item) => total + messageText(item.message).length,
        0,
      ),
    });
  }
  return groups;
}

@Injectable()
export class ChatContextService {
  public constructor(
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
  ) {}

  public prepare(input: {
    history?: ChatMessage[];
    messageHistory?: ChatHistoryMessage[];
    currentUserMessage: string;
    memoryContext?: string;
    contextSummary?: string | null | undefined;
    summaryThroughMessageId?: string | null | undefined;
  }): ContextPlan {
    const window = this.getContextWindow();
    const inputBudget = Math.floor(window * 0.8);
    const trigger = Math.floor(inputBudget * 0.75);
    const hardLimit = Math.floor(inputBudget * 0.9);
    const recentBudget = Math.floor(inputBudget * 0.3);
    const system = [
      this.llmService.createSystemContextMessage(),
      ...(input.memoryContext ? [new SystemMessage(input.memoryContext)] : []),
    ];
    const current = new HumanMessage(input.currentUserMessage);
    const allHistory =
      input.messageHistory ?? toLegacyHistory(input.history ?? []);
    const groups = completeMessageGroups(allHistory);
    for (const group of groups) {
      group.tokens = this.countMessages(
        group.items.map((item) => item.message),
      );
    }
    const allMessages = [
      ...system,
      ...groups.flatMap((group) => group.items.map((item) => item.message)),
      current,
    ];

    if (this.countMessages(allMessages) <= trigger) {
      return {
        messages: allMessages,
        needsSummary: false,
        summarySource: [],
        lastIncludedMessageId: allHistory.at(-1)?.id ?? null,
        hardLimit,
      };
    }

    const recent: MessageGroup[] = [];
    let recentTokens = this.countMessages([current]);
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const candidate = groups[index];
      if (!candidate) continue;
      if (recent.length > 0 && recentTokens + candidate.tokens > recentBudget) {
        break;
      }
      recent.unshift(candidate);
      recentTokens += candidate.tokens;
    }

    const coveredIndex = input.summaryThroughMessageId
      ? groups.findIndex((group) =>
          group.items.some(
            (message) => message.id === input.summaryThroughMessageId,
          ),
        )
      : -1;
    const firstRecentIndex = recent.length
      ? groups.indexOf(recent[0]!)
      : groups.length;
    const messageSummarySource = groups
      .slice(coveredIndex + 1, firstRecentIndex)
      .flatMap((group) => group.items);
    const summaryIds = new Set(messageSummarySource.map((item) => item.id));
    const summarySource = (input.history ?? []).filter((item) =>
      summaryIds.has(item.id),
    );

    const messages: BaseMessage[] = [
      ...system,
      ...(input.contextSummary
        ? [new HumanMessage(`[历史摘要]\n${input.contextSummary}`)]
        : []),
      ...recent.flatMap((group) => group.items.map((item) => item.message)),
      current,
    ];

    while (this.countMessages(messages) > hardLimit && recent.length > 0) {
      const removed = recent.shift();
      if (!removed) {
        break;
      }
      const removedMessages = new Set(
        removed.items.map((item) => item.message),
      );
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (removedMessages.has(messages[index]!)) {
          messages.splice(index, 1);
        }
      }
    }

    return {
      messages,
      needsSummary: messageSummarySource.length > 0,
      summarySource,
      messageSummarySource,
      lastIncludedMessageId:
        messageSummarySource.at(-1)?.id ??
        input.summaryThroughMessageId ??
        null,
      hardLimit,
    };
  }

  public countMessages(messages: BaseMessage[]): number {
    return this.countText(messages.map(messageText));
  }

  public countTokens(messages: ChatInput['messages']): number {
    return this.countText(
      messages.map((message) =>
        message instanceof BaseMessage ? messageText(message) : message.content,
      ),
    );
  }

  private countText(contents: string[]): number {
    const encodingName =
      this.configService.get<string>('LLM_TOKEN_ENCODING')?.trim() ||
      'cl100k_base';
    let encoder: ReturnType<typeof getEncoding> | undefined;
    try {
      encoder = getEncoding(encodingName as Parameters<typeof getEncoding>[0]);
      return contents.reduce(
        (total, content) => total + encoder!.encode(content).length + 4,
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

  public getContextWindow(): number {
    const value = Number(
      this.configService.get<string>('LLM_CONTEXT_WINDOW_TOKENS'),
    );
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ServiceUnavailableException(
        'LLM_CONTEXT_WINDOW_TOKENS 配置无效',
      );
    }
    return value;
  }
}
