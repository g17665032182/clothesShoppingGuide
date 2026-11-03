import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { LockMode, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityRepository } from '@mikro-orm/postgresql';
import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { LlmUsage } from '../../llm/graph/llm.state.js';
import type { LlmStreamEvent } from '../../llm/stream/llm-stream.types.js';
import {
  ChatTraceEvent,
  ChatTraceEventType,
} from '../entity/chat-trace-event.entity.js';
import {
  displayEnvelope,
  isRecord,
  jsonBytes,
  MAX_DISPLAY_BYTES,
  MAX_TRACE_PAYLOAD_BYTES,
  projectContext,
  projectSources,
  reservedDisplayBytes,
  restoreDisplay,
  safeToolName,
} from './chat-display.projection.js';
import type {
  ChatActivity,
  ChatDisplayData,
  ChatDisplayEvent,
} from './chat-display.types.js';

@Injectable()
export class ChatDisplayService {
  private readonly logger = new Logger(ChatDisplayService.name);
  private readonly sourceNamespaces = new WeakMap<ChatDisplayData, string>();

  public constructor(
    @InjectRepository(ChatTraceEvent)
    private readonly events: EntityRepository<ChatTraceEvent>,
  ) {}

  public create(contextWindowTokens: number): ChatDisplayData {
    if (
      !Number.isSafeInteger(contextWindowTokens) ||
      contextWindowTokens <= 0
    ) {
      throw new ServiceUnavailableException('聊天上下文窗口配置无效');
    }
    const data: ChatDisplayData = {
      activities: [],
      sources: [],
      context: projectContext(contextWindowTokens, null),
    };
    this.sourceNamespaces.set(data, randomUUID());
    return data;
  }

  public apply(
    data: ChatDisplayData,
    event: LlmStreamEvent,
  ): ChatDisplayEvent | null {
    if (event.type === 'delta') return null;
    if (event.type === 'sources') {
      const identities = new Map(
        data.sources.map((source) => [source.url, source.id]),
      );
      const namespace = this.sourceNamespaces.get(data) ?? randomUUID();
      // 按本轮随机命名空间派生稳定 ID，避免保存无限增长的历史 URL 映射。
      const sources = projectSources(event.sources, identities, false, (url) =>
        createHash('sha256').update(namespace).update(url).digest('hex'),
      );
      this.assertBudget({ ...data, sources });
      data.sources = sources;
      this.sourceNamespaces.set(data, namespace);
      return { type: 'sources', sources };
    }

    let activity: ChatActivity;
    if (event.type === 'reasoning') {
      if (!event.id.trim() || !event.summary.trim()) return null;
      activity = {
        type: 'reasoning',
        id: event.id.trim(),
        summary: event.summary.trim(),
      };
    } else {
      if (!event.id.trim()) return null;
      activity = {
        type: 'tool',
        id: event.id.trim(),
        toolName: safeToolName(event.toolName),
        status: event.type === 'tool-call' ? 'running' : event.status,
        // 工具参数和结果采用显式允许策略；回显及未知工具都没有公开字段。
        input: null,
        output: null,
      };
    }

    const activities = [...data.activities];
    const position = activities.findIndex((item) => item.id === activity.id);
    if (position === -1) activities.push(activity);
    else activities[position] = activity;
    this.assertBudget({ ...data, activities });
    data.activities = activities;
    return { type: 'activity', activity };
  }

  public complete(
    data: ChatDisplayData,
    usage: LlmUsage | null,
  ): ChatDisplayData {
    const context = data.context
      ? projectContext(data.context.contextWindowTokens, usage)
      : null;
    this.assertBudget({ ...data, context });
    data.context = context;
    return data;
  }

  public assertBudget(data: ChatDisplayData): void {
    if (reservedDisplayBytes(data) > MAX_DISPLAY_BYTES) {
      throw new ServiceUnavailableException('聊天展示数据超出安全保存上限');
    }
  }

  public async bind(
    transaction: EntityManager,
    input: {
      conversationId: string;
      runId: string;
      sequence: number;
      assistantMessageId: string;
      data: ChatDisplayData;
    },
  ): Promise<void> {
    this.assertBudget(input.data);
    const envelope = restoreDisplay(
      displayEnvelope(input.data, input.assistantMessageId),
    );
    if (!envelope || jsonBytes(envelope) > MAX_DISPLAY_BYTES) {
      throw new ServiceUnavailableException('聊天展示数据不符合安全保存要求');
    }
    const trace = await transaction.findOne(
      ChatTraceEvent,
      {
        conversationId: input.conversationId,
        runId: input.runId,
        sequence: input.sequence,
        eventType: ChatTraceEventType.MODEL_RESPONSE,
      },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!trace || (trace.payload !== null && !isRecord(trace.payload))) {
      throw new ConflictException('聊天展示数据无法绑定最终模型事件');
    }
    const original = trace.payload ?? {};
    if (Object.hasOwn(original, 'publicDisplay')) {
      if (isDeepStrictEqual(original.publicDisplay, envelope)) return;
      throw new ConflictException('聊天展示数据绑定冲突');
    }
    const payload = { ...original, publicDisplay: envelope };
    if (jsonBytes(payload) > MAX_TRACE_PAYLOAD_BYTES) {
      throw new ServiceUnavailableException('聊天展示数据超出安全保存上限');
    }
    trace.payload = payload;
    // 使用调用方的消息事务，不另开事务，绑定失败由调用方整体回滚。
    await transaction.flush();
  }

  public async read(
    conversationId: string,
    assistantMessageIds: string[],
  ): Promise<Map<string, ChatDisplayData>> {
    const result = new Map<string, ChatDisplayData>();
    if (assistantMessageIds.length === 0) return result;
    const ids = [...new Set(assistantMessageIds)];
    const rows = await this.events.find(
      {
        conversationId,
        eventType: ChatTraceEventType.MODEL_RESPONSE,
        payload: {
          publicDisplay: { assistantMessageId: { $in: ids } },
        },
      },
      { fields: ['id', 'runId', 'sequence', 'payload'] },
    );
    const requestedIds = new Set(ids);
    const bindingCounts = new Map<string, number>();
    for (const row of rows) {
      const payload: unknown = row.payload;
      const envelope = isRecord(payload) ? payload.publicDisplay : undefined;
      const id = isRecord(envelope) ? envelope.assistantMessageId : undefined;
      if (typeof id === 'string') {
        bindingCounts.set(id, (bindingCounts.get(id) ?? 0) + 1);
      }
    }
    for (const row of rows) {
      let restored;
      try {
        const payload: unknown = row.payload;
        restored = restoreDisplay(
          isRecord(payload) ? payload.publicDisplay : undefined,
        );
      } catch {
        restored = null;
      }
      if (!restored || !requestedIds.has(restored.assistantMessageId)) {
        this.logger.warn('忽略无效的聊天公开展示元数据');
        continue;
      }
      const id = restored.assistantMessageId;
      if ((bindingCounts.get(id) ?? 0) > 1) {
        this.logger.warn('忽略绑定冲突的聊天公开展示元数据');
        continue;
      }
      result.set(id, {
        activities: restored.activities,
        sources: restored.sources,
        context: restored.context,
      });
    }
    return result;
  }
}
