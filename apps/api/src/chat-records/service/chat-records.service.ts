import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  DriverException,
  TransactionPropagation,
  type EntityManager,
} from '@mikro-orm/core';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import type { ChatInput, TryOnActionInput } from '../../llm/dto/chat.dto.js';
import {
  LlmService,
  type ChatOutput,
  type LlmExecutionOptions,
} from '../../llm/service/llm.service.js';
import type { LlmTraceEvent } from '../../llm/trace/llm-trace.types.js';
import { mapTraceEventsToMessages } from '../history/chat-history.mapper.js';
import type { User } from '../../users/entity/user.entity.js';
import { ChatContextService } from '../context/chat-context.service.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import {
  ChatMessage,
  ChatRecordMessageRole,
} from '../entity/chat-message.entity.js';
import { ChatSummaryService } from './chat-summary.service.js';
import { ChatTraceEvent } from '../entity/chat-trace-event.entity.js';
import { ChatTraceWriterService } from '../trace/chat-trace-writer.service.js';
import type { AdminChatQueryDto } from '../dto/admin-chat-query.dto.js';
import type { PaginationDto } from '../dto/pagination.dto.js';
import {
  USER_MEMORY_READER,
  USER_MEMORY_TASKS,
  type UserMemoryReader,
  type UserMemoryTasks,
} from '../../user-memory/index.js';
import {
  USER_PREFERENCES_READER,
  USER_PREFERENCES_LIFECYCLE,
  type UserPreferencesReader,
  type UserPreferencesLifecycle,
} from '../../user-preferences/index.js';
import { ChatDisplayService } from '../display/chat-display.service.js';
import type {
  ChatDisplayData,
  ChatDisplayEvent,
  ChatTryOnResult,
  ChatTryOnStatus,
} from '../display/chat-display.types.js';
import { createChatCardDisplayTool } from '../display/chat-card-display.tool.js';
import { createChatCardSourceRegistry } from '../display/chat-card-source-registry.js';
import type { LlmEventStreamResult } from '../../llm/stream/llm-stream.types.js';
import { ProductCatalogService } from '../../product-catalog/index.js';
import { createProductSearchTool } from '../../product-catalog/tool/product-search.tool.js';
import {
  PurchaseDraftService,
  createPurchaseTools,
  createRequestPurchaseFormTool,
  type PurchaseRunState,
} from '../../chat-purchase/index.js';
import { ChatConversationAccess } from '../conversation-access/index.js';
import { eligibleSummaryTraceIds } from './chat-summary-source.js';
import { OrdersService, createListUserOrdersTool } from '../../orders/index.js';
import {
  CHAT_TRY_ON_PORT,
  type ChatTryOnOutcome,
  type ChatTryOnPort,
  type ChatTryOnStatus as ChatTryOnProgress,
} from '../../virtual-try-on/port/chat-try-on.port.js';
import { createChatTryOnTool } from '../try-on/chat-try-on.tool.js';
import type { BaseMessage } from '@langchain/core/messages';
import {
  ChatDynamicFormService,
  type DynamicFormDefinition,
} from '../../chat-dynamic-form/index.js';
import { createRequestDynamicFormTool } from '../../llm/tools/request-dynamic-form.tool.js';
import { ChatUserInformationService } from '../../chat-user-information/index.js';
import { PurchaseAddressCoordinator } from '../tools/purchase-address-coordinator.js';
import { createChatUserInformationTool } from '../tools/chat-user-information.tool.js';

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ConversationResponse = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageResponse = ChatDisplayData & {
  id: string;
  conversationId: string;
  role: ChatRecordMessageRole;
  content: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  createdAt: string;
};

export type ConversationDetailResponse = ConversationResponse & {
  messages: Page<MessageResponse>;
};

export type PersistedChatOutput = ChatOutput & {
  conversationId: string;
  title: string;
  cards: ChatDisplayData['cards'];
  purchase: ChatDisplayData['purchase'];
  forms: DynamicFormDefinition[];
  tryOnResult?: ChatTryOnResult;
  tryOnStatus?: ChatTryOnStatus;
};

export type ChatStreamEvent =
  | ChatDisplayEvent
  | { type: 'purchase'; purchase: NonNullable<ChatDisplayData['purchase']> }
  | { type: 'purchase-form' }
  | { type: 'form'; form: DynamicFormDefinition }
  | {
      type: 'start';
      conversationId: string;
      title: string;
      contextWindowTokens: number;
    }
  | {
      type: 'delta';
      content: string;
    }
  | {
      type: 'try-on-status';
      taskId: string;
      status: 'queued' | 'processing';
    }
  | {
      type: 'done';
      conversationId: string;
      title: string;
      model: string;
      usage: ChatOutput['usage'];
      context: ChatDisplayData['context'];
      tryOnResult?: ChatTryOnResult;
      tryOnStatus?: ChatTryOnStatus;
    };

type TryOnExecution = {
  outcome: ChatTryOnOutcome;
  ephemeralModelMessages: BaseMessage[];
};

type PreparedChat = {
  conversation: ChatConversation | null;
  persistedConversation: ChatConversation;
  currentUserMessage: string;
  runId: string;
  traceWriter: ChatTraceWriterService;
  plan: ReturnType<ChatContextService['prepare']>;
  nextContextSummary: string | null | undefined;
  nextSummaryThroughMessageId: string | null | undefined;
  memoryContext: string;
  contextWindowTokens: number;
  purchaseState: PurchaseRunState;
  purchaseToolUsed: boolean;
  tryOnTasksRequested: boolean;
  pendingPurchaseFormRequest: boolean;
  purchaseFormEventSent: boolean;
  purchaseReferencedDraftId?: string;
  pendingDynamicForms: DynamicFormDefinition[];
  tryOnAction?: TryOnActionInput;
};

class AsyncSignalQueue {
  private readonly waiters: Array<() => void> = [];
  private count = 0;
  private closed = false;

  public push(): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter();
    else this.count += 1;
  }

  public next(): Promise<void> {
    if (this.count > 0) {
      this.count -= 1;
      return Promise.resolve();
    }
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  public close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}

@Injectable()
export class ChatRecordsService {
  private readonly logger = new Logger(ChatRecordsService.name);

  public constructor(
    @InjectRepository(ChatConversation)
    private readonly conversations: EntityRepository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messages: EntityRepository<ChatMessage>,
    @InjectRepository(ChatTraceEvent)
    private readonly traceEvents: EntityRepository<ChatTraceEvent>,
    private readonly llmService: LlmService,
    private readonly contextService: ChatContextService,
    private readonly summaryService: ChatSummaryService,
    private readonly traceWriter: ChatTraceWriterService,
    @Inject(USER_MEMORY_READER)
    private readonly memoryReader: UserMemoryReader,
    @Inject(USER_MEMORY_TASKS)
    private readonly memoryTasks: UserMemoryTasks,
    @Inject(USER_PREFERENCES_LIFECYCLE)
    private readonly preferenceLifecycle: UserPreferencesLifecycle,
    private readonly displayService: ChatDisplayService,
    @Inject(USER_PREFERENCES_READER)
    private readonly preferenceReader: UserPreferencesReader,
    private readonly productCatalog: ProductCatalogService,
    private readonly purchaseDrafts: PurchaseDraftService,
    private readonly conversationAccess: ChatConversationAccess,
    @Optional() private readonly orders?: OrdersService,
    @Optional()
    @Inject(CHAT_TRY_ON_PORT)
    private readonly tryOn?: ChatTryOnPort,
    @Optional()
    private readonly dynamicForms?: ChatDynamicFormService,
    @Optional()
    private readonly userInformation?: ChatUserInformationService,
  ) {}

  public async chat(user: User, dto: ChatInput): Promise<PersistedChatOutput> {
    const prepared = await this.prepareChat(user, dto);
    await this.ensureConversationPersisted(prepared);
    const display = this.displayService.create(prepared.contextWindowTokens);
    const tryOn = prepared.tryOnAction
      ? await this.executeTryOn(prepared)
      : undefined;
    this.applyTryOnDisplay(display, tryOn?.outcome);
    const result = await this.runChatModel(prepared, display, tryOn);
    // 非流式接口没有 SSE 事件通道，模型工具创建的表单在保存前写入公开快照并直接返回。
    const forms = prepared.pendingDynamicForms.splice(0);
    for (const form of forms) {
      this.displayService.stageDynamicForm(display, form);
    }
    if (
      result.finalTraceSequence === null ||
      result.finalTraceSequence === undefined
    )
      throw new ServiceUnavailableException('最终模型记录缺失，无法保存回复');
    this.displayService.complete(display, result.usage);
    await this.persistChat(prepared, result, {
      data: display,
      sequence: result.finalTraceSequence,
    });
    const { finalTraceSequence: _sequence, ...publicResult } = result;

    return {
      ...publicResult,
      conversationId: prepared.persistedConversation.id,
      title: prepared.persistedConversation.title,
      cards: display.cards,
      purchase: display.purchase,
      forms,
      ...(display.tryOnResult ? { tryOnResult: display.tryOnResult } : {}),
      ...(display.tryOnStatus ? { tryOnStatus: display.tryOnStatus } : {}),
    };
  }

  public async prepareStream(
    user: User,
    dto: ChatInput,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<ChatStreamEvent>> {
    const prepared = await this.prepareChat(user, dto);
    return this.streamPrepared(prepared, signal);
  }

  private async *streamPrepared(
    prepared: PreparedChat,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    await this.ensureConversationPersisted(prepared);
    let persistedMessages = false;
    try {
      const display = this.displayService.create(prepared.contextWindowTokens);
      yield {
        type: 'start',
        conversationId: prepared.persistedConversation.id,
        title: prepared.persistedConversation.title,
        contextWindowTokens: prepared.contextWindowTokens,
      };
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      const tryOn = prepared.tryOnAction
        ? yield* this.executeTryOnWithStatus(prepared, signal)
        : undefined;
      this.applyTryOnDisplay(display, tryOn?.outcome);

      if (tryOn) {
        let result: ChatOutput;
        try {
          result = await this.llmService.chatPrepared(
            { messages: prepared.plan.messages },
            this.traceContext(prepared, signal),
            this.tools(prepared, display, true),
            this.executionOptions(tryOn),
          );
        } catch (error) {
          if (
            tryOn.outcome.status !== 'succeeded' ||
            signal?.aborted ||
            (error instanceof DOMException && error.name === 'AbortError')
          ) {
            throw error;
          }
          result = await this.serverFallback(prepared);
        }
        await this.finalizeStream(prepared, display, result);
        persistedMessages = true;
        const purchaseFormEvent = this.takePurchaseFormRequest(prepared);
        if (purchaseFormEvent) yield purchaseFormEvent;
        yield { type: 'delta', content: result.content };
        if (display.purchase)
          yield { type: 'purchase', purchase: display.purchase };
        yield this.doneEvent(prepared, display, result);
        return;
      }

      const resultIterator = this.llmService.streamEventsPrepared(
        { messages: prepared.plan.messages },
        signal,
        this.traceContext(prepared, signal),
        this.tools(prepared, display, true),
      );
      let result: LlmEventStreamResult | undefined;
      try {
        while (true) {
          const next = await resultIterator.next();
          if (next.done) {
            result = next.value;
            break;
          }
          if (next.value.type === 'delta') {
            yield next.value;
            const purchaseFormEvent = this.takePurchaseFormRequest(prepared);
            if (purchaseFormEvent) yield purchaseFormEvent;
          } else {
            for (const form of prepared.pendingDynamicForms.splice(0)) {
              this.displayService.stageDynamicForm(display, form);
              yield { type: 'form', form };
            }
            const event = this.displayService.apply(display, next.value);
            if (event) yield event;
            const purchaseFormEvent = this.takePurchaseFormRequest(prepared);
            if (purchaseFormEvent) yield purchaseFormEvent;
          }
        }
      } finally {
        await resultIterator.return(undefined as never);
      }

      if (!result || signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      if (result.finalTraceSequence === null) {
        throw new ServiceUnavailableException('最终模型记录缺失，无法保存回复');
      }
      this.displayService.complete(display, result.usage);
      await this.persistChat(prepared, result, {
        data: display,
        sequence: result.finalTraceSequence,
      });
      persistedMessages = true;
      if (display.purchase)
        yield { type: 'purchase', purchase: display.purchase };
      yield this.doneEvent(prepared, display, result);
    } finally {
      if (
        !persistedMessages &&
        signal?.aborted &&
        prepared.conversation === null
      ) {
        await this.deleteConversation(prepared.persistedConversation);
      }
    }
  }

  public async listForUser(
    userId: string,
    pagination: PaginationDto,
  ): Promise<Page<ConversationResponse>> {
    return this.list({ userId }, pagination);
  }

  public async listForAdmin(
    query: AdminChatQueryDto,
  ): Promise<Page<ConversationResponse>> {
    return this.list(query.userId ? { userId: query.userId } : {}, query);
  }

  public async getForUser(
    userId: string,
    id: string,
    pagination: PaginationDto,
  ): Promise<ConversationDetailResponse> {
    return this.getDetail({ userId, id }, pagination);
  }

  public async getForAdmin(
    id: string,
    pagination: PaginationDto,
  ): Promise<ConversationDetailResponse> {
    return this.getDetail({ id }, pagination);
  }

  public async deleteForUser(userId: string, id: string): Promise<void> {
    const conversation = await this.getOwnedConversation(userId, id);
    const entityManager = this.conversations.getEntityManager();
    await entityManager.transactional(async (transactionalEntityManager) => {
      await this.preferenceLifecycle.markConversationDeleted(
        transactionalEntityManager,
        conversation.id,
        userId,
      );
      await this.conversationAccess.lockOwnedInTransaction(
        transactionalEntityManager,
        userId,
        id,
      );
      await transactionalEntityManager.nativeDelete(ChatConversation, {
        id,
        userId,
      });
      await transactionalEntityManager.flush();
    });
  }

  public generateConversationTitle(content: string): string {
    const normalized = content.replace(/\s+/gu, ' ').trim();
    const characters = Array.from(normalized);
    return characters.length > 30
      ? `${characters.slice(0, 30).join('')}...`
      : characters.join('');
  }

  private async prepareChat(user: User, dto: ChatInput): Promise<PreparedChat> {
    this.llmService.assertConfigured();
    const currentUserMessage = [...dto.messages]
      .reverse()
      .find((message) => message.role === 'user');
    if (!currentUserMessage) {
      throw new BadRequestException('聊天请求至少需要一条 user 消息');
    }
    const sources = await Promise.allSettled([
      this.preferenceReader.readContext(user.id, currentUserMessage.content),
      this.memoryReader.readContext(user.id, currentUserMessage.content),
    ]);
    const [preference, memory] = sources.map((source, index) => {
      if (source.status === 'fulfilled') return source.value;
      this.logger.warn(
        `${index === 0 ? 'PREFERENCES' : 'MEMORY'}_CONTEXT_UNAVAILABLE`,
      );
      return '';
    });
    const memoryContext = this.contextService.composeLongTermContext(
      preference ?? '',
      memory ?? '',
    );

    const conversation = dto.conversationId
      ? await this.getOwnedConversation(user.id, dto.conversationId)
      : null;
    const purchaseState: PurchaseRunState = conversation
      ? await this.purchaseDrafts.runState(user.id, conversation.id)
      : { fingerprint: '', active: false, context: '', reference: null };
    const legacyMessages = conversation
      ? await this.messages.find(
          { conversationId: conversation.id },
          { orderBy: { createdAt: 'asc' } },
        )
      : [];
    let traceHistory = conversation
      ? await this.traceEvents.find(
          { conversationId: conversation.id },
          { orderBy: { createdAt: 'asc', sequence: 'asc' } },
        )
      : [];
    if (
      conversation &&
      traceHistory.length === 0 &&
      legacyMessages.length > 0
    ) {
      const legacyRunId = '00000000-0000-4000-8000-000000000001';
      const legacyEvents = legacyMessages.reduce<LlmTraceEvent[]>(
        (events, message, sequence) => {
          if (message.role === ChatRecordMessageRole.USER) {
            events.push({
              sequence,
              type: 'input',
              messageId: message.id,
              content: message.content,
            });
          } else {
            events.push({
              sequence,
              type: 'model_response',
              messageId: message.id,
              content: message.content,
              model: message.model,
              usage: {
                inputTokens: message.inputTokens,
                outputTokens: message.outputTokens,
                totalTokens: message.totalTokens,
              },
            });
          }
          return events;
        },
        [],
      );
      await this.traceWriter.writeEvents(
        { conversationId: conversation.id, runId: legacyRunId },
        legacyEvents,
      );
      traceHistory = await this.traceEvents.find(
        { conversationId: conversation.id },
        { orderBy: { createdAt: 'asc', sequence: 'asc' } },
      );
    }
    const history = conversation ? mapTraceEventsToMessages(traceHistory) : [];
    const summaryEligibleIds = eligibleSummaryTraceIds(
      traceHistory,
      legacyMessages,
    );
    let plan = this.contextService.prepare({
      history: legacyMessages,
      messageHistory: history,
      currentUserMessage: currentUserMessage.content,
      memoryContext,
      purchaseContext: purchaseState.context,
      contextSummary: conversation?.contextSummary,
      summaryThroughMessageId: conversation?.summaryThroughMessageId,
    });

    let nextContextSummary: string | null | undefined;
    let nextSummaryThroughMessageId: string | null | undefined;
    if (plan.needsSummary) {
      const summarySource = plan.messageSummarySource
        ? plan.messageSummarySource.filter((message) =>
            summaryEligibleIds.has(`${message.runId ?? ''}:${message.id}`),
          )
        : plan.summarySource;
      const summary = summarySource.length
        ? await this.summaryService.summarize(
            conversation?.contextSummary ?? null,
            summarySource,
          )
        : null;
      if ((summary || plan.summaryWatermarkAdvanced) && conversation) {
        nextContextSummary = summary ?? conversation.contextSummary;
        nextSummaryThroughMessageId = plan.lastIncludedMessageId;
        plan = this.contextService.prepare({
          history: legacyMessages,
          messageHistory: history,
          currentUserMessage: currentUserMessage.content,
          memoryContext,
          purchaseContext: purchaseState.context,
          contextSummary: summary ?? conversation.contextSummary,
          summaryThroughMessageId: plan.lastIncludedMessageId,
        });
      }
    }

    const persistedConversation =
      conversation ??
      Object.assign(new ChatConversation(), {
        userId: user.id,
        title: this.generateConversationTitle(currentUserMessage.content),
      });
    return {
      conversation,
      persistedConversation,
      currentUserMessage: currentUserMessage.content,
      runId: randomUUID(),
      traceWriter: this.traceWriter,
      plan,
      nextContextSummary,
      nextSummaryThroughMessageId,
      memoryContext,
      contextWindowTokens: this.contextService.getContextWindow(),
      purchaseState,
      purchaseToolUsed: false,
      tryOnTasksRequested: false,
      pendingPurchaseFormRequest: false,
      purchaseFormEventSent: false,
      pendingDynamicForms: [],
      ...(dto.tryOnAction ? { tryOnAction: dto.tryOnAction } : {}),
    };
  }

  private async executeTryOn(
    prepared: PreparedChat,
    signal?: AbortSignal,
    onStatus?: (status: ChatTryOnProgress) => void,
  ): Promise<TryOnExecution> {
    if (!prepared.tryOnAction || !this.tryOn) {
      throw new ServiceUnavailableException('试穿工具暂不可用');
    }
    const action = prepared.tryOnAction;
    const callId = randomUUID();
    const actionMessageId = randomUUID();
    let outcome: ChatTryOnOutcome;

    try {
      const tryOnTool = createChatTryOnTool(this.tryOn, {
        userId: prepared.persistedConversation.userId,
        color: action.color,
        consentVersion: action.consentVersion,
        ...(signal ? { signal } : {}),
        ...(onStatus ? { onStatus } : {}),
      });
      const toolMessage = await tryOnTool.invoke({
        type: 'tool_call',
        id: callId,
        name: tryOnTool.name,
        args: {
          productExternalId: action.productExternalId,
          photoId: action.photoId,
        },
      });
      if (!(toolMessage instanceof ToolMessage)) {
        throw new Error('invalid tool result');
      }
      outcome = this.restoreTryOnOutcome(toolMessage.artifact);
    } catch (error) {
      if (signal?.aborted) throw error;
      outcome = {
        status: 'failed',
        code: 'TRY_ON_UNAVAILABLE',
      };
    }

    const safeCall = {
      id: callId,
      name: 'try_on_product',
      type: 'tool_call',
      // 照片 ID、同意版本只存在本次服务端调用上下文，不写入历史参数。
      args: { productExternalId: action.productExternalId },
    };
    const safeToolResult =
      outcome.status === 'succeeded'
        ? { status: outcome.status, taskId: outcome.result.taskId }
        : {
            status: outcome.status,
            ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
            code: outcome.code,
          };
    await this.traceWriter.writeEvents(
      {
        conversationId: prepared.persistedConversation.id,
        runId: prepared.runId,
      },
      [
        {
          sequence: 0,
          type: 'input',
          messageId: null,
          content: prepared.currentUserMessage,
        },
        {
          sequence: 1,
          type: 'model_response',
          messageId: actionMessageId,
          content: '',
          model: null,
          usage: null,
          status: 'partial',
          payload: { origin: 'server_action', toolCalls: [safeCall] },
        },
        {
          sequence: 2,
          type: 'tool_result',
          messageId: null,
          toolCallId: callId,
          toolName: 'try_on_product',
          content: JSON.stringify(safeToolResult),
          status: 'success',
        },
      ],
    );

    return {
      outcome,
      ephemeralModelMessages: this.tryOnModelMessages(outcome),
    };
  }

  private async *executeTryOnWithStatus(
    prepared: PreparedChat,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent, TryOnExecution> {
    const statuses: ChatStreamEvent[] = [];
    const notifications = new AsyncSignalQueue();
    let emitted = 0;
    const execution = this.executeTryOn(prepared, signal, (status) => {
      statuses.push({ type: 'try-on-status', ...status });
      notifications.push();
    }).finally(() => notifications.close());

    while (true) {
      if (emitted < statuses.length) {
        yield statuses[emitted++]!;
        continue;
      }
      const next = await Promise.race([
        execution.then((value) => ({ done: true as const, value })),
        notifications.next().then(() => ({ done: false as const })),
      ]);
      if (next.done) {
        while (emitted < statuses.length) {
          yield statuses[emitted++]!;
        }
        return next.value;
      }
    }
  }

  private restoreTryOnOutcome(value: unknown): ChatTryOnOutcome {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 'failed', code: 'TRY_ON_UNAVAILABLE' };
    }
    const source = value as Record<string, unknown>;
    if (
      source.status === 'failed' &&
      typeof source.code === 'string' &&
      /^[A-Z0-9_]{1,80}$/u.test(source.code)
    ) {
      return {
        status: 'failed',
        ...(typeof source.taskId === 'string' ? { taskId: source.taskId } : {}),
        code: source.code,
      };
    }
    if (
      source.status === 'timed_out' &&
      typeof source.code === 'string' &&
      /^[A-Z0-9_]{1,80}$/u.test(source.code)
    ) {
      return {
        status: 'timed_out',
        ...(typeof source.taskId === 'string' ? { taskId: source.taskId } : {}),
        code: source.code,
      };
    }
    if (
      source.status !== 'succeeded' ||
      typeof source.result !== 'object' ||
      source.result === null ||
      Array.isArray(source.result)
    ) {
      return { status: 'failed', code: 'TRY_ON_UNAVAILABLE' };
    }
    const result = source.result as Record<string, unknown>;
    const product =
      typeof result.product === 'object' &&
      result.product !== null &&
      !Array.isArray(result.product)
        ? (result.product as Record<string, unknown>)
        : {};
    const summary =
      typeof result.result === 'object' &&
      result.result !== null &&
      !Array.isArray(result.result)
        ? (result.result as Record<string, unknown>)
        : {};
    if (
      typeof result.taskId !== 'string' ||
      !Buffer.isBuffer(result.image) ||
      result.image.byteLength === 0 ||
      result.image.byteLength > 10 * 1024 * 1024 ||
      typeof product.externalId !== 'string' ||
      typeof product.name !== 'string' ||
      typeof product.color !== 'string' ||
      !Number.isSafeInteger(summary.width) ||
      !Number.isSafeInteger(summary.height) ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(
        String(summary.mimeType),
      )
    ) {
      return { status: 'failed', code: 'TRY_ON_UNAVAILABLE' };
    }
    return {
      status: 'succeeded',
      result: {
        taskId: result.taskId,
        product: {
          externalId: product.externalId,
          name: product.name,
          color: product.color,
        },
        result: {
          width: summary.width as number,
          height: summary.height as number,
          mimeType: summary.mimeType as
            'image/png' | 'image/jpeg' | 'image/webp',
        },
        image: result.image,
      },
    };
  }

  private tryOnModelMessages(outcome: ChatTryOnOutcome): BaseMessage[] {
    if (outcome.status !== 'succeeded') {
      return [
        new SystemMessage(
          `服务端试穿状态为 ${outcome.status}，状态码为 ${outcome.code}。请只据此向用户说明，不要臆测生成结果。`,
        ),
      ];
    }
    const image = outcome.result.image.toString('base64');
    const url = `data:${outcome.result.result.mimeType};base64,${image}`;
    return [
      new HumanMessage({
        content: [
          { type: 'text', text: '这是本次试穿结果，仅供视觉参考。' },
          { type: 'image_url', image_url: { url } },
        ],
      }),
    ];
  }

  private executionOptions(execution?: TryOnExecution): LlmExecutionOptions {
    return execution
      ? {
          traceSequence: 3,
          skipPersistInput: true,
          ephemeralModelMessages: execution.ephemeralModelMessages,
        }
      : {};
  }

  private applyTryOnDisplay(
    display: ChatDisplayData,
    outcome?: ChatTryOnOutcome,
  ): void {
    if (!outcome) return;
    if (outcome.status === 'succeeded') {
      this.displayService.setTryOnResult(display, {
        taskId: outcome.result.taskId,
        product: outcome.result.product,
        result: outcome.result.result,
      });
    } else {
      this.displayService.setTryOnStatus(display, {
        status: outcome.status,
        ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
        code: outcome.code,
      });
    }
  }

  private async runChatModel(
    prepared: PreparedChat,
    display: ChatDisplayData,
    execution?: TryOnExecution,
  ): Promise<ChatOutput> {
    try {
      return await this.llmService.chatPrepared(
        { messages: prepared.plan.messages },
        this.traceContext(prepared),
        this.tools(prepared, display),
        this.executionOptions(execution),
      );
    } catch (error) {
      if (execution?.outcome.status === 'succeeded') {
        return this.serverFallback(prepared);
      }
      throw error;
    }
  }

  private async serverFallback(prepared: PreparedChat): Promise<ChatOutput> {
    const content =
      '试穿结果已生成，但暂时无法生成文字回复。你可以直接查看结果图。';
    const traceContext = {
      conversationId: prepared.persistedConversation.id,
      runId: prepared.runId,
    };
    const sequence = await this.traceWriter.nextSequence(traceContext);
    const model = this.llmService.assertConfigured();
    await this.traceWriter.writeEvents(traceContext, [
      {
        sequence,
        type: 'model_response',
        messageId: randomUUID(),
        content,
        model,
        usage: null,
        status: 'failed',
        payload: {
          origin: 'server_fallback',
          code: 'TRY_ON_CHAT_MODEL_UNAVAILABLE',
        },
      },
    ]);
    return {
      content,
      model,
      usage: null,
      finalTraceSequence: sequence,
    };
  }

  private async finalizeStream(
    prepared: PreparedChat,
    display: ChatDisplayData,
    result: ChatOutput,
  ): Promise<void> {
    if (
      result.finalTraceSequence === null ||
      result.finalTraceSequence === undefined
    ) {
      throw new ServiceUnavailableException('最终模型记录缺失，无法保存回复');
    }
    this.displayService.complete(display, result.usage);
    await this.persistChat(prepared, result, {
      data: display,
      sequence: result.finalTraceSequence,
    });
  }

  private doneEvent(
    prepared: PreparedChat,
    display: ChatDisplayData,
    result: ChatOutput,
  ): ChatStreamEvent {
    return {
      type: 'done',
      conversationId: prepared.persistedConversation.id,
      title: prepared.persistedConversation.title,
      model: result.model,
      usage: result.usage,
      context: display.context,
      ...(display.tryOnResult ? { tryOnResult: display.tryOnResult } : {}),
      ...(display.tryOnStatus ? { tryOnStatus: display.tryOnStatus } : {}),
    };
  }

  private tools(
    prepared: PreparedChat,
    display: ChatDisplayData,
    includePurchaseForm = false,
  ) {
    const cardSources = createChatCardSourceRegistry();
    const addressCoordinator = this.userInformation
      ? new PurchaseAddressCoordinator(
          this.userInformation,
          this.purchaseDrafts,
          prepared.persistedConversation.userId,
          prepared.persistedConversation.id,
          prepared.purchaseState.active,
          prepared.currentUserMessage,
          (draftId, draftVersion) =>
            this.displayService.stageAddressSelection(
              display,
              draftId,
              draftVersion,
            ),
        )
      : undefined;
    return [
      createProductSearchTool(this.productCatalog, (results) =>
        cardSources.registerProducts(results),
      ),
      ...createPurchaseTools(
        this.purchaseDrafts,
        prepared.persistedConversation.userId,
        prepared.persistedConversation.id,
        (draftId) => {
          prepared.purchaseToolUsed = true;
          if (draftId) prepared.purchaseReferencedDraftId = draftId;
        },
      ),
      ...(includePurchaseForm
        ? [
            createRequestPurchaseFormTool(
              async () => {
                const { draft } = await this.purchaseDrafts.read(
                  prepared.persistedConversation.userId,
                  prepared.persistedConversation.id,
                );
                return Boolean(
                  draft && ['collecting', 'ready'].includes(draft.status),
                );
              },
              () => {
                if (!prepared.purchaseFormEventSent) {
                  prepared.pendingPurchaseFormRequest = true;
                }
              },
            ),
          ]
        : []),
      createListUserOrdersTool(
        this.orders!,
        prepared.persistedConversation.userId,
        (orders) => cardSources.registerOrders(orders),
      ),
      createChatCardDisplayTool(cardSources, (card) =>
        this.displayService.stageCard(display, card),
      ),
      ...(addressCoordinator
        ? [
            createChatUserInformationTool(addressCoordinator, () => {
              prepared.tryOnTasksRequested = true;
            }),
          ]
        : []),
      createRequestDynamicFormTool(
        async (input) => {
          if (!this.dynamicForms)
            throw new ServiceUnavailableException('动态表单暂不可用');
          return this.dynamicForms.request({
            userId: prepared.persistedConversation.userId,
            conversationId: prepared.persistedConversation.id,
            runId: prepared.runId,
            input,
          });
        },
        (form) => {
          prepared.pendingDynamicForms.push(form);
        },
        addressCoordinator
          ? (input) => addressCoordinator.preflightDynamicForm(input)
          : undefined,
      ),
    ];
  }

  private takePurchaseFormRequest(
    prepared: PreparedChat,
  ): ChatStreamEvent | null {
    if (!prepared.pendingPurchaseFormRequest || prepared.purchaseFormEventSent)
      return null;
    prepared.pendingPurchaseFormRequest = false;
    prepared.purchaseFormEventSent = true;
    return { type: 'purchase-form' };
  }

  private traceContext(prepared: PreparedChat, signal?: AbortSignal) {
    return {
      conversationId: prepared.persistedConversation.id,
      runId: prepared.runId,
      writer: prepared.traceWriter,
      model: this.llmService.assertConfigured(),
      ...(signal ? { signal } : {}),
    };
  }

  private async ensureConversationPersisted(
    prepared: PreparedChat,
  ): Promise<void> {
    if (prepared.conversation) return;
    const entityManager = this.conversations.getEntityManager();
    entityManager.persist(prepared.persistedConversation);
    await entityManager.flush();
  }

  private async deleteConversation(
    conversation: ChatConversation,
  ): Promise<void> {
    const entityManager = this.conversations.getEntityManager();
    await entityManager.transactional(async (transaction) => {
      await this.conversationAccess.lockOwnedInTransaction(
        transaction,
        conversation.userId,
        conversation.id,
      );
      const state = await this.purchaseDrafts.runStateInTransaction(
        transaction,
        conversation.userId,
        conversation.id,
      );
      if (
        state.reference ||
        (await transaction.count(ChatMessage, {
          conversationId: conversation.id,
        }))
      )
        return;
      await transaction.nativeDelete(ChatConversation, {
        id: conversation.id,
        userId: conversation.userId,
      });
    });
  }

  private async persistChat(
    prepared: PreparedChat,
    result: ChatOutput,
    display?: { data: ChatDisplayData; sequence: number },
  ): Promise<void> {
    const persistedConversation = prepared.persistedConversation;
    persistedConversation.updatedAt = new Date();
    const userMessage = Object.assign(new ChatMessage(), {
      conversationId: persistedConversation.id,
      role: ChatRecordMessageRole.USER,
      content: prepared.currentUserMessage,
    });
    const assistantMessage = Object.assign(new ChatMessage(), {
      conversationId: persistedConversation.id,
      role: ChatRecordMessageRole.ASSISTANT,
      content: result.content,
      model: result.model,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null,
    });

    const entityManager = this.conversations.getEntityManager();
    await entityManager.transactional(async (transactionalEntityManager) => {
      await this.conversationAccess.lockOwnedInTransaction(
        transactionalEntityManager,
        persistedConversation.userId,
        persistedConversation.id,
      );
      const currentPurchase = await this.purchaseDrafts.runStateInTransaction(
        transactionalEntityManager,
        persistedConversation.userId,
        persistedConversation.id,
      );
      const eligible =
        !prepared.purchaseState.active &&
        !prepared.purchaseToolUsed &&
        !prepared.tryOnTasksRequested &&
        prepared.purchaseState.fingerprint === currentPurchase.fingerprint;
      userMessage.memoryExtractionEligible = eligible;
      assistantMessage.memoryExtractionEligible = eligible;
      // 重新读取当前会话，禁止将生成前的陈旧对象重新插入或覆盖并发更新。
      const currentConversation =
        await transactionalEntityManager.findOneOrFail(ChatConversation, {
          id: persistedConversation.id,
          userId: persistedConversation.userId,
        });
      currentConversation.updatedAt = new Date();
      if (prepared.nextContextSummary !== undefined) {
        currentConversation.contextSummary = prepared.nextContextSummary;
        currentConversation.summaryThroughMessageId =
          prepared.nextSummaryThroughMessageId ?? null;
      }
      transactionalEntityManager.persist(currentConversation);
      await transactionalEntityManager.flush();
      transactionalEntityManager.persist([userMessage, assistantMessage]);
      await transactionalEntityManager.flush();
      if (display) {
        // 回复只关联本轮实际使用的草稿，生成期间替换的新草稿不能冒充原购买。
        const referencedDraftId =
          prepared.purchaseReferencedDraftId ??
          prepared.purchaseState.reference?.draftId;
        const reference = referencedDraftId
          ? await this.purchaseDrafts.referenceInTransaction(
              transactionalEntityManager,
              persistedConversation.userId,
              persistedConversation.id,
              referencedDraftId,
            )
          : null;
        this.displayService.setPurchaseReference(display.data, reference);
        await this.displayService.bind(transactionalEntityManager, {
          conversationId: persistedConversation.id,
          runId: prepared.runId,
          sequence: display.sequence,
          assistantMessageId: assistantMessage.id,
          data: display.data,
        });
      }
      const taskInput = {
        userId: persistedConversation.userId,
        conversationId: persistedConversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
      };
      // Markdown 长期记忆仍由独立后台流程处理；结构化偏好由用户自行维护。
      if (eligible)
        await this.enqueueDomain(
          transactionalEntityManager,
          'MEMORY',
          (transaction) =>
            this.memoryTasks.enqueueInTransaction(transaction, taskInput),
        );
    });
  }

  private async enqueueDomain(
    entityManager: EntityManager,
    domain: 'PREFERENCES' | 'MEMORY',
    enqueue: (transaction: EntityManager) => Promise<void>,
  ): Promise<void> {
    try {
      await entityManager.transactional(enqueue, {
        propagation: TransactionPropagation.NESTED,
      });
    } catch (error) {
      // 连接故障与未知程序错误交给外层回滚，避免将整个数据库故障误报为已隔离。
      const sqlState =
        error instanceof DriverException
          ? error.code
          : error instanceof Error &&
              'code' in error &&
              typeof error.code === 'string'
            ? error.code
            : undefined;
      if (!/^(22|23|42)[0-9A-Z]{3}$/u.test(sqlState ?? '')) {
        throw error;
      }
      this.logger.warn(`${domain}_ENQUEUE_FAILED`);
    }
  }

  private async list(
    where: { userId?: string },
    pagination: PaginationDto,
  ): Promise<Page<ConversationResponse>> {
    const [items, total] = await this.conversations.findAndCount(where, {
      orderBy: { updatedAt: 'desc' },
      limit: pagination.normalizedPageSize,
      offset: pagination.offset,
    });
    return {
      items: items.map((item) => this.toConversationResponse(item)),
      total,
      page: pagination.normalizedPage,
      pageSize: pagination.normalizedPageSize,
      totalPages: Math.ceil(total / pagination.normalizedPageSize),
    };
  }

  private async getDetail(
    where: { userId?: string; id: string },
    pagination: PaginationDto,
  ): Promise<ConversationDetailResponse> {
    const conversation = await this.conversations.findOne(where);
    if (!conversation) {
      throw new NotFoundException('聊天会话不存在');
    }
    const [messages, total] = await this.messages.findAndCount(
      { conversationId: conversation.id },
      {
        orderBy: { createdAt: 'asc' },
        limit: pagination.normalizedPageSize,
        offset: pagination.offset,
      },
    );
    const displays = await this.displayService.read(
      conversation.id,
      messages
        .filter((message) => message.role === ChatRecordMessageRole.ASSISTANT)
        .map((message) => message.id),
      where.userId,
    );
    return {
      ...this.toConversationResponse(conversation),
      messages: {
        items: messages.map((item) => ({
          ...this.toMessageResponse(item),
          ...(displays.get(item.id) ?? {}),
        })),
        total,
        page: pagination.normalizedPage,
        pageSize: pagination.normalizedPageSize,
        totalPages: Math.ceil(total / pagination.normalizedPageSize),
      },
    };
  }

  private async getOwnedConversation(
    userId: string,
    id: string,
  ): Promise<ChatConversation> {
    const conversation = await this.conversations.findOne({ id, userId });
    if (!conversation) {
      throw new NotFoundException('聊天会话不存在');
    }
    return conversation;
  }

  private toConversationResponse(
    conversation: ChatConversation,
  ): ConversationResponse {
    return {
      id: conversation.id,
      userId: conversation.userId,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private toMessageResponse(message: ChatMessage): MessageResponse {
    return {
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      model: message.model,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      totalTokens: message.totalTokens,
      createdAt: message.createdAt.toISOString(),
      activities: [],
      sources: [],
      productResults: [],
      orderCancellationCandidates: [],
      context: null,
      cards: [],
      purchase: null,
    };
  }
}
