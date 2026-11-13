import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { LockMode, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityRepository } from '@mikro-orm/postgresql';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { LlmUsage } from '../../llm/graph/llm.state.js';
import type { LlmStreamEvent } from '../../llm/stream/llm-stream.types.js';
import {
  CHAT_TRY_ON_PORT,
  type ChatTryOnPort,
} from '../../virtual-try-on/port/chat-try-on.port.js';
import {
  PRODUCT_CATALOG_TRY_ON_PORT,
  productSearchQuerySchema,
  type ProductCatalogTryOnPort,
} from '../../product-catalog/index.js';
import {
  ChatTraceEvent,
  ChatTraceEventType,
} from '../entity/chat-trace-event.entity.js';
import {
  displayEnvelope,
  isRecord,
  jsonBytes,
  isValidPurchaseReference,
  MAX_DISPLAY_BYTES,
  MAX_TRACE_PAYLOAD_BYTES,
  projectContext,
  projectSources,
  reservedDisplayBytes,
  restoreDisplay,
  restoreChatCard,
  restoreChatCardOutput,
  restoreOrderCancellationCandidates,
  restoreProductResults,
  safeToolName,
  restoreChatTryOnResult,
  restoreChatTryOnStatus,
  restoreDynamicFormDefinition,
} from './chat-display.projection.js';
import type {
  ChatActivity,
  ChatCard,
  ChatDisplayData,
  ChatDisplayEvent,
  OrderCancellationCandidate,
  PurchaseReference,
  ChatTryOnResult,
  ChatDynamicFormReference,
} from './chat-display.types.js';

@Injectable()
export class ChatDisplayService {
  private readonly logger = new Logger(ChatDisplayService.name);
  private readonly sourceNamespaces = new WeakMap<ChatDisplayData, string>();
  private readonly productQueries = new WeakMap<
    ChatDisplayData,
    Map<string, ReturnType<typeof productSearchQuerySchema.parse>>
  >();
  private readonly cancellationQueries = new WeakMap<
    ChatDisplayData,
    Set<string>
  >();
  private readonly stagedCardOutputs = new WeakMap<
    ChatDisplayData,
    Map<string, number>
  >();
  private readonly pendingAddressSelectionCards = new WeakMap<
    ChatDisplayData,
    ChatCard
  >();

  public constructor(
    @InjectRepository(ChatTraceEvent)
    private readonly events: EntityRepository<ChatTraceEvent>,
    @Inject(PRODUCT_CATALOG_TRY_ON_PORT)
    private readonly catalog: ProductCatalogTryOnPort,
    @Optional()
    @Inject(CHAT_TRY_ON_PORT)
    private readonly tryOn?: ChatTryOnPort,
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
      cards: [],
      productResults: [],
      orderCancellationCandidates: [],
      context: projectContext(contextWindowTokens, null),
      purchase: null,
      forms: [],
    };
    this.sourceNamespaces.set(data, randomUUID());
    return data;
  }

  public stageCard(data: ChatDisplayData, value: unknown): ChatCard {
    const card = restoreChatCard(value);
    if (!card) {
      throw new ServiceUnavailableException('卡片展示数据不符合安全要求');
    }
    const cards = [...data.cards, card];
    this.assertBudget({ ...data, cards });
    data.cards = cards;

    const key = JSON.stringify(card);
    const staged =
      this.stagedCardOutputs.get(data) ?? new Map<string, number>();
    staged.set(key, (staged.get(key) ?? 0) + 1);
    this.stagedCardOutputs.set(data, staged);
    return card;
  }

  public stageAddressSelection(
    data: ChatDisplayData,
    draftId: string,
    draftVersion: number,
  ): ChatCard {
    const card = restoreChatCard({
      type: 'card',
      name: 'address_selection',
      data: { draftId, draftVersion },
    });
    if (!card || card.name !== 'address_selection') {
      throw new ServiceUnavailableException('地址选择引用不符合安全要求');
    }
    if (
      !data.cards.some(
        (candidate) =>
          candidate.name === 'address_selection' &&
          candidate.data.draftId === draftId &&
          candidate.data.draftVersion === draftVersion,
      )
    ) {
      const cards = [...data.cards, card];
      this.assertBudget({ ...data, cards });
      data.cards = cards;
    }
    this.pendingAddressSelectionCards.set(data, card);
    return card;
  }

  /**
   * 只把动态表单的安全引用写入公开快照，完整定义仅通过本轮 SSE 发送。
   */
  public stageDynamicForm(
    data: ChatDisplayData,
    value: unknown,
  ): ChatDynamicFormReference {
    const definition = restoreDynamicFormDefinition(value);
    if (!definition) {
      throw new ServiceUnavailableException('动态表单数据不符合安全要求');
    }
    const reference: ChatDynamicFormReference = {
      formId: definition.formId,
      revision: definition.revision,
      formKind: definition.formKind,
      status: definition.status,
    };
    const currentForms = data.forms ?? [];
    if (!currentForms.some((item) => item.formId === reference.formId)) {
      const forms = [...currentForms, reference].slice(-5);
      this.assertBudget({ ...data, forms });
      data.forms = forms;
    }
    return reference;
  }

  public apply(
    data: ChatDisplayData,
    event: LlmStreamEvent,
  ): ChatDisplayEvent | null {
    if (event.type === 'delta') return null;
    if (
      event.type === 'tool-result' &&
      event.status === 'success' &&
      ['get_my_information', 'request_dynamic_form'].includes(event.toolName)
    ) {
      const card = this.pendingAddressSelectionCards.get(data);
      if (card) {
        this.pendingAddressSelectionCards.delete(data);
        return { type: 'card', card };
      }
    }
    if (event.type === 'tool-call' && event.toolName === 'display_chat_card') {
      return null;
    }
    if (
      event.type === 'tool-result' &&
      event.toolName === 'display_chat_card' &&
      event.status === 'success'
    ) {
      const card = restoreChatCardOutput(event.output);
      if (card) {
        const key = JSON.stringify(card);
        const staged = this.stagedCardOutputs.get(data);
        const count = staged?.get(key) ?? 0;
        if (count > 0) {
          if (count === 1) staged?.delete(key);
          else staged?.set(key, count - 1);
          return { type: 'card', card };
        }
      }
    }
    if (
      event.type === 'tool-call' &&
      event.toolName === 'search_local_clothing_products'
    ) {
      const parsed = productSearchQuerySchema.safeParse({
        ...(typeof event.input === 'object' && event.input !== null
          ? event.input
          : {}),
        limit: 3,
      });
      if (parsed.success) {
        const queries = this.productQueries.get(data) ?? new Map();
        queries.set(event.id, parsed.data);
        this.productQueries.set(data, queries);
      }
    }
    if (event.type === 'tool-call' && event.toolName === 'list_my_orders') {
      const input =
        typeof event.input === 'object' && event.input !== null
          ? (event.input as Record<string, unknown>)
          : {};
      if (input.status === 'pending_payment') {
        const queries = this.cancellationQueries.get(data) ?? new Set<string>();
        queries.add(event.id);
        this.cancellationQueries.set(data, queries);
      }
    }
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
    if (
      event.type === 'tool-result' &&
      event.toolName === 'search_local_clothing_products'
    ) {
      const restored = restoreProductResults(event.output);
      const query = this.productQueries.get(data)?.get(event.id);
      this.productQueries.get(data)?.delete(event.id);
      const results = restored && query ? { ...restored, query } : restored;
      const activity: Extract<ChatActivity, { type: 'tool' }> = {
        type: 'tool',
        id: event.id,
        toolName: safeToolName(event.toolName),
        status: event.status === 'success' ? 'success' : 'error',
        input: null,
        output: null,
      };
      const activities = [...data.activities];
      const position = activities.findIndex((item) => item.id === activity.id);
      if (position === -1) activities.push(activity);
      else activities[position] = activity;
      if (!results) {
        this.assertBudget({ ...data, activities });
        data.activities = activities;
        return { type: 'activity', activity };
      }
      const productResults = [...data.productResults, results].slice(-5);
      this.assertBudget({ ...data, productResults, activities });
      data.productResults = productResults;
      data.activities = activities;
      return { type: 'product-results', results, activity };
    }
    if (event.type === 'tool-result' && event.toolName === 'list_my_orders') {
      const cancellationQueries = this.cancellationQueries.get(data);
      const isCancellationQuery =
        cancellationQueries?.delete(event.id) ?? false;
      const candidates =
        isCancellationQuery && event.status === 'success'
          ? restoreOrderCancellationCandidates(event.output)
          : null;
      const activity: Extract<ChatActivity, { type: 'tool' }> = {
        type: 'tool',
        id: event.id,
        toolName: safeToolName(event.toolName),
        status: event.status === 'success' ? 'success' : 'error',
        input: null,
        output: null,
      };
      const activities = [...data.activities];
      const position = activities.findIndex((item) => item.id === activity.id);
      if (position === -1) activities.push(activity);
      else activities[position] = activity;
      if (!candidates) {
        this.assertBudget({ ...data, activities });
        data.activities = activities;
        return { type: 'activity', activity };
      }
      const orderCancellationCandidates: OrderCancellationCandidate[] =
        candidates;
      this.assertBudget({
        ...data,
        activities,
        orderCancellationCandidates,
      });
      data.activities = activities;
      data.orderCancellationCandidates = orderCancellationCandidates;
      return {
        type: 'order-cancellation-candidates',
        orderCancellationCandidates,
        activity,
      };
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

  public setPurchaseReference(
    data: ChatDisplayData,
    reference: PurchaseReference | null,
  ): void {
    if (!isValidPurchaseReference(reference)) {
      throw new ServiceUnavailableException('购买引用不符合安全保存要求');
    }
    const previous = data.purchase;
    data.purchase = reference;
    try {
      this.assertBudget(data);
    } catch (error) {
      data.purchase = previous;
      throw error;
    }
  }

  public setTryOnResult(data: ChatDisplayData, value: unknown): void {
    const result = restoreChatTryOnResult(value);
    if (!result) {
      throw new ServiceUnavailableException('试穿结果引用不符合安全要求');
    }
    const previousResult = data.tryOnResult;
    const previousStatus = data.tryOnStatus;
    data.tryOnResult = result;
    delete data.tryOnStatus;
    try {
      this.assertBudget(data);
    } catch (error) {
      if (previousResult) data.tryOnResult = previousResult;
      else delete data.tryOnResult;
      if (previousStatus) data.tryOnStatus = previousStatus;
      throw error;
    }
  }

  public setTryOnStatus(data: ChatDisplayData, value: unknown): void {
    const status = restoreChatTryOnStatus(value);
    if (!status) {
      throw new ServiceUnavailableException('试穿状态不符合安全要求');
    }
    const previousResult = data.tryOnResult;
    const previousStatus = data.tryOnStatus;
    data.tryOnStatus = status;
    delete data.tryOnResult;
    try {
      this.assertBudget(data);
    } catch (error) {
      if (previousStatus) data.tryOnStatus = previousStatus;
      else delete data.tryOnStatus;
      if (previousResult) data.tryOnResult = previousResult;
      throw error;
    }
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
    ownerUserId?: string,
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
        cards: restored.cards,
        productResults: restored.productResults,
        orderCancellationCandidates: restored.orderCancellationCandidates,
        context: restored.context,
        purchase: restored.purchase,
        forms: restored.forms ?? [],
        ...(restored.tryOnResult ? { tryOnResult: restored.tryOnResult } : {}),
        ...(restored.tryOnStatus ? { tryOnStatus: restored.tryOnStatus } : {}),
      });
    }
    await this.refreshTryOnAvailability(result);
    await this.refreshTryOnResults(result, ownerUserId);
    return result;
  }

  private async refreshTryOnResults(
    displays: Map<string, ChatDisplayData>,
    ownerUserId?: string,
  ): Promise<void> {
    for (const display of displays.values()) {
      const result: ChatTryOnResult | undefined = display.tryOnResult;
      if (!result) continue;
      if (!ownerUserId) {
        delete display.tryOnResult;
        continue;
      }
      if (
        !this.tryOn ||
        !(await this.tryOn.canReadResult(ownerUserId, result.taskId))
      ) {
        delete display.tryOnResult;
      }
    }
  }

  private async refreshTryOnAvailability(
    displays: Map<string, ChatDisplayData>,
  ): Promise<void> {
    const items = [...displays.values()].flatMap((display) => [
      ...display.productResults.flatMap((results) => results.items),
      ...display.cards.flatMap((card) =>
        card.name === 'product' ? card.data.items : [],
      ),
    ]);
    const externalIds = [...new Set(items.map((item) => item.externalId))];
    if (externalIds.length === 0) return;

    const enabled = new Set<string>();
    try {
      for (let offset = 0; offset < externalIds.length; offset += 200) {
        const products = await this.catalog.getTryOnProducts(
          externalIds.slice(offset, offset + 200),
        );
        for (const [externalId, product] of products) {
          if (product.tryOnEnabled && product.tryOnEligible) {
            enabled.add(externalId);
          }
        }
      }
    } catch {
      // 资格读取异常时仅关闭入口，历史正文和商品快照继续可读，且不记录原始载荷。
      enabled.clear();
      this.logger.warn('商品试穿资格暂不可用，历史试穿入口已关闭');
    }
    // 只更新恢复出的响应对象，不修改持久化的 publicDisplay 或历史价格和图片。
    for (const item of items) item.tryOnEnabled = enabled.has(item.externalId);
  }
}
