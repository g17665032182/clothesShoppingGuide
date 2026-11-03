import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityManager } from '@mikro-orm/core';
import { type EntityRepository } from '@mikro-orm/postgresql';

import type {
  LlmTraceEvent,
  LlmTraceWriteContext,
} from '../../llm/trace/llm-trace.types.js';

import {
  ChatTraceEvent,
  ChatTraceEventStatus,
  ChatTraceEventType,
} from '../entity/chat-trace-event.entity.js';

const MAX_PAYLOAD_BYTES = 32_768;
const CREDENTIAL_KEY_PATTERN =
  /password|secret|token|api[_-]?key|authorization|credential/i;
const REDACTED_VALUE = '[REDACTED]';

type NormalizedEvent = {
  sequence: number;
  eventType: ChatTraceEventType;
  messageId: string | null;
  toolCallId: string | null;
  toolName: string | null;
  content: string | null;
  payload: Record<string, unknown> | unknown[] | null;
  status: ChatTraceEventStatus | null;
  model: string | null;
  usage: Record<string, unknown> | null;
};

const TRACE_EVENT_TYPES: Record<LlmTraceEvent['type'], ChatTraceEventType> = {
  input: ChatTraceEventType.INPUT,
  model_response: ChatTraceEventType.MODEL_RESPONSE,
  tool_call: ChatTraceEventType.TOOL_CALL,
  tool_result: ChatTraceEventType.TOOL_RESULT,
};

function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error('循环引用不可保存');
    }
    seen.add(value);
    const result = value.map((item) => redactValue(item, seen));
    seen.delete(value);
    return result;
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      throw new Error('循环引用不可保存');
    }
    seen.add(value);
    const result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        CREDENTIAL_KEY_PATTERN.test(key)
          ? REDACTED_VALUE
          : redactValue(item, seen),
      ]),
    );
    seen.delete(value);
    return result;
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }

  throw new Error('事件包含不可序列化的数据');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizePayload(value: unknown): Record<string, unknown> | unknown[] {
  const sanitized = redactValue(value);
  const normalized =
    !Array.isArray(sanitized) && typeof sanitized !== 'object'
      ? { value: sanitized }
      : sanitized === null
        ? { value: null }
        : sanitized;
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('事件 payload 超出保存上限');
  }
  return normalized as Record<string, unknown> | unknown[];
}

function normalizeContent(content: string): string {
  if (Buffer.byteLength(content, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('事件内容超出保存上限');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  const sanitized = redactValue(parsed);
  const normalized = JSON.stringify(sanitized);
  if (Buffer.byteLength(normalized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('事件 payload 超出保存上限');
  }
  return normalized;
}

function normalizeEvent(event: LlmTraceEvent): NormalizedEvent {
  if (
    event.type === 'model_response' &&
    typeof event.payload === 'object' &&
    event.payload !== null &&
    Object.hasOwn(event.payload, 'publicDisplay')
  ) {
    throw new Error('运行事件不能写入展示保留字段');
  }
  const base: NormalizedEvent = {
    sequence: event.sequence,
    eventType: TRACE_EVENT_TYPES[event.type],
    messageId: event.messageId,
    toolCallId: null,
    toolName: null,
    content: null,
    payload: null,
    status: null,
    model: null,
    usage: null,
  };

  switch (event.type) {
    case 'input':
      return { ...base, content: event.content };
    case 'model_response':
      return {
        ...base,
        content: event.content,
        payload:
          event.payload === undefined ? null : normalizePayload(event.payload),
        model: event.model,
        usage: event.usage
          ? {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              totalTokens: event.usage.totalTokens,
            }
          : null,
      };
    case 'tool_call':
      return {
        ...base,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        payload: normalizePayload(event.args),
      };
    case 'tool_result':
      return {
        ...base,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content:
          event.status === 'failed'
            ? '工具执行失败'
            : normalizeContent(event.content),
        status:
          event.status === 'success'
            ? ChatTraceEventStatus.SUCCESS
            : ChatTraceEventStatus.FAILED,
        payload:
          event.payload === undefined ? null : normalizePayload(event.payload),
      };
  }
}

function toEntity(
  context: LlmTraceWriteContext,
  event: NormalizedEvent,
): ChatTraceEvent {
  return Object.assign(new ChatTraceEvent(), {
    conversationId: context.conversationId,
    runId: context.runId,
    ...event,
  });
}

@Injectable()
export class ChatTraceWriterService {
  public constructor(
    @InjectRepository(ChatTraceEvent)
    private readonly events: EntityRepository<ChatTraceEvent>,
  ) {}

  public async writeEvents(
    context: LlmTraceWriteContext,
    events: LlmTraceEvent[],
  ): Promise<void> {
    if (events.length === 0) return;

    let normalized: NormalizedEvent[];
    try {
      normalized = events.map(normalizeEvent);
    } catch {
      throw new Error('聊天过程事件不符合安全保存要求');
    }

    const entityManager = this.events.getEntityManager();
    try {
      await entityManager.transactional(async (transaction) => {
        for (const event of normalized) {
          await this.persistIdempotently(transaction, context, event);
        }
        await transaction.flush();
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new Error('聊天过程记录保存失败');
    }
  }

  private async persistIdempotently(
    transaction: EntityManager,
    context: LlmTraceWriteContext,
    event: NormalizedEvent,
  ): Promise<void> {
    const identity = {
      conversationId: context.conversationId,
      runId: context.runId,
      sequence: event.sequence,
    };
    const existing = await transaction.findOne(ChatTraceEvent, identity);
    if (existing) {
      const candidate = toEntity(context, event);
      if (this.sameEvent(existing, candidate)) return;
      throw new ConflictException('聊天过程事件幂等冲突');
    }
    transaction.persist(toEntity(context, event));
  }

  private sameEvent(
    existing: ChatTraceEvent,
    candidate: ChatTraceEvent,
  ): boolean {
    return (
      existing.eventType === candidate.eventType &&
      existing.messageId === candidate.messageId &&
      existing.toolCallId === candidate.toolCallId &&
      existing.toolName === candidate.toolName &&
      existing.content === candidate.content &&
      existing.status === candidate.status &&
      existing.model === candidate.model &&
      stableStringify(this.identityPayload(existing)) ===
        stableStringify(this.identityPayload(candidate)) &&
      stableStringify(existing.usage) === stableStringify(candidate.usage)
    );
  }

  private identityPayload(event: ChatTraceEvent): ChatTraceEvent['payload'] {
    const payload = event.payload;
    if (
      event.eventType !== ChatTraceEventType.MODEL_RESPONSE ||
      payload === null ||
      Array.isArray(payload)
    ) {
      return payload;
    }
    // 绑定后无法区分原来的 null 和空对象，统一视作无原始字段；其余字段严格比较。
    const { publicDisplay: _display, ...original } = payload;
    return Object.keys(original).length === 0 ? null : original;
  }
}
