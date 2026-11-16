import assert from 'node:assert/strict';
import test from 'node:test';

import type { LlmService } from '../../llm/service/llm.service.js';
import type {
  LlmEventStreamResult,
  LlmStreamEvent,
} from '../../llm/stream/llm-stream.types.js';
import { ChatDisplayService } from '../display/chat-display.service.js';
import { ChatRecordsService } from '../service/chat-records.service.js';
import { ChatContextService } from '../context/chat-context.service.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import { ChatMessage } from '../entity/chat-message.entity.js';
import { ChatTraceEvent } from '../entity/chat-trace-event.entity.js';
import type { ChatHistoryMessage } from '../history/chat-history.mapper.js';
import { PaginationDto } from '../dto/pagination.dto.js';
import type { ChatTryOnPort } from '../../virtual-try-on/port/chat-try-on.port.js';

type DetailRequest =
  | 'sku'
  | 'sku_empty'
  | 'sku_not_found'
  | 'sku_unavailable'
  | 'preferences'
  | 'preferences_empty'
  | 'preferences_disabled'
  | 'preferences_unavailable'
  | 'none';

function createService(
  options: {
    failFlush?: boolean;
    failBind?: boolean;
    missingTrace?: boolean;
    tools?: boolean;
    userInformation?: boolean;
    informationRequests?: Array<
      'success' | 'empty' | 'unavailable' | 'photos' | 'none'
    >;
    detailRequests?: DetailRequest[];
    purchaseActive?: boolean;
    summaryHistory?: { messages: ChatMessage[]; traces: ChatTraceEvent[] };
    cancellationCandidates?: boolean;
    purchaseForm?: boolean;
    repeatPurchaseForm?: boolean;
    purchaseFormStatus?: 'collecting' | 'ready' | 'submitted' | null;
    failedReader?: 'preferences' | 'memory';
    tryOn?: ChatTryOnPort;
    modelFailure?: boolean;
  } = {},
) {
  const persisted: unknown[] = [];
  const removed: unknown[] = [];
  const modelInputs: unknown[] = [];
  const modelExecutionOptions: unknown[] = [];
  const bindings: unknown[] = [];
  const memoryEnqueued: unknown[] = [];
  const summarySources: unknown[][] = [];
  let informationOutcome = 'none';
  let detailOutcome: DetailRequest = 'none';
  const detailRequests = [...(options.detailRequests ?? [])];
  const informationRequests = [...(options.informationRequests ?? [])];
  const invokeInformation = async (tools: unknown[]) => {
    detailOutcome = detailRequests.shift() ?? 'none';
    if (detailOutcome !== 'none') {
      const skus = detailOutcome.startsWith('sku');
      const query = tools.find(
        (item) =>
          (item as { name?: string }).name ===
          (skus ? 'get_product_skus' : 'get_my_preferences'),
      ) as { invoke: (input: unknown) => Promise<unknown> } | undefined;
      assert.ok(query);
      await query.invoke(skus ? { productExternalId: 'verified-shirt' } : {});
    }
    informationOutcome = informationRequests.shift() ?? 'none';
    if (informationOutcome === 'none') return;
    const query = tools.find(
      (item) => (item as { name?: string }).name === 'get_my_information',
    ) as { invoke: (input: unknown) => Promise<unknown> } | undefined;
    assert.ok(query);
    await query.invoke({
      sections: [informationOutcome === 'photos' ? 'photos' : 'try_on_tasks'],
    });
  };
  const traceEvents: unknown[] = [];
  const registeredToolNames: string[][] = [];
  const purchaseFormReads: Array<[string, string]> = [];
  const contextInputs: Array<{ memoryContext?: string }> = [];
  const existingConversation =
    options.purchaseActive || options.summaryHistory
      ? Object.assign(new ChatConversation(), {
          userId: 'user-1',
          title: '购买',
        })
      : null;
  const getToolNames = (tools: unknown[]) =>
    tools.flatMap((item) => {
      if (
        typeof item === 'object' &&
        item !== null &&
        'name' in item &&
        typeof item.name === 'string'
      ) {
        return [item.name];
      }
      return [];
    });
  let flushCount = 0;
  const manager = {
    persist(value: unknown) {
      persisted.push(value);
    },
    remove(value: unknown) {
      removed.push(value);
    },
    async flush() {
      flushCount += 1;
      if (options.failFlush && flushCount === 2) {
        throw new Error('database failure');
      }
    },
    async findOneOrFail() {
      return (
        existingConversation ??
        (persisted.find(
          (item) => item instanceof ChatConversation,
        ) as ChatConversation)
      );
    },
    async count() {
      return 0;
    },
    async nativeDelete() {
      const value = persisted.find((item) => item instanceof ChatConversation);
      if (value) removed.push(value);
      return value ? 1 : 0;
    },
    async transactional<T>(
      callback: (transactionalManager: unknown) => Promise<T>,
    ) {
      return callback(manager);
    },
  };
  const conversationRepository = {
    findOne: async () => existingConversation,
    getEntityManager: () => manager,
  };
  const messageRepository = {
    find: async () => options.summaryHistory?.messages ?? [],
  };
  const traceEventRepository = {
    find: async () => options.summaryHistory?.traces ?? [],
  };
  const llmService = {
    assertConfigured: () => 'fake-model',
    chatPrepared: async (
      input: unknown,
      _traceContext: unknown,
      tools: unknown[],
      execution: unknown,
    ) => {
      registeredToolNames.push(getToolNames(tools));
      modelInputs.push(input);
      modelExecutionOptions.push(execution);
      if (options.modelFailure) throw new Error('controlled model failure');
      await invokeInformation(tools);
      return {
        content: '回复',
        model: 'fake-model',
        usage: null,
        finalTraceSequence: 4,
      };
    },
    async *streamEventsPrepared(
      _input: unknown,
      _signal: unknown,
      _traceContext: unknown,
      extraTools: unknown[] = [],
    ): AsyncGenerator<LlmStreamEvent, LlmEventStreamResult> {
      registeredToolNames.push(getToolNames(extraTools));
      await invokeInformation(extraTools);
      yield { type: 'delta', content: '第一段' };
      if (options.purchaseForm) {
        const requestTool = extraTools.find(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            'name' in item &&
            item.name === 'request_purchase_form',
        );
        assert.ok(
          requestTool &&
            typeof requestTool === 'object' &&
            'invoke' in requestTool &&
            typeof requestTool.invoke === 'function',
        );
        const callCount = options.repeatPurchaseForm ? 2 : 1;
        for (let index = 0; index < callCount; index += 1) {
          const id = `purchase-form-call-${index}`;
          yield {
            type: 'tool-call',
            id,
            toolName: 'request_purchase_form',
            input: {},
          };
          const output = await requestTool.invoke({});
          yield {
            type: 'tool-result',
            id,
            toolName: 'request_purchase_form',
            status: 'success',
            output: String(output),
          };
        }
      }
      if (options.tools) {
        yield {
          type: 'tool-call',
          id: 'call-1',
          toolName: 'local_echo_tool',
          input: { secret: 'private' },
        };
        yield {
          type: 'tool-result',
          id: 'call-1',
          toolName: 'local_echo_tool',
          status: 'success',
          output: 'private',
        };
      }
      if (options.cancellationCandidates) {
        yield {
          type: 'tool-call',
          id: 'order-call-1',
          toolName: 'list_my_orders',
          input: { status: 'pending_payment' },
        };
        yield {
          type: 'tool-result',
          id: 'order-call-1',
          toolName: 'list_my_orders',
          status: 'success',
          output: JSON.stringify({
            ok: true,
            orders: [
              {
                orderId: '123e4567-e89b-42d3-a456-426614174000',
                orderNo: 'ORD-20261110-001',
                status: 'pending_payment',
                payableAmount: '129.00',
                createdAt: '2026-11-10T08:00:00.000Z',
                expiresAt: '2026-11-10T08:30:00.000Z',
                cancelable: true,
                items: [
                  {
                    productName: '针织衫',
                    color: '灰色',
                    size: 'M',
                    quantity: 1,
                  },
                ],
              },
            ],
          }),
        };
      }
      yield { type: 'delta', content: '第二段' };
      return {
        content: '第一段第二段',
        model: 'fake-model',
        usage: null,
        finalTraceSequence: options.missingTrace ? null : 4,
      };
    },
  };
  const contextService = {
    getContextWindow: () => 8192,
    truncateToTokens: (content: string) => content,
    composeLongTermContext: (preferences: string, memory: string) =>
      [preferences, memory].filter(Boolean).join('\n\n'),
    prepare: (input: {
      memoryContext?: string;
      messageHistory?: ChatHistoryMessage[];
    }) => {
      contextInputs.push(input);
      return {
        messages: [
          { role: 'system' as const, content: '服务端上下文' },
          { role: 'user' as const, content: '你好' },
        ],
        needsSummary: Boolean(
          options.summaryHistory && contextInputs.length === 1,
        ),
        messageSummarySource: input.messageHistory ?? [],
        summarySource: [],
        lastIncludedMessageId: options.summaryHistory
          ? 'summary-through'
          : null,
        hardLimit: 100,
      };
    },
  };
  const summaryService = {
    summarize: async (_previous: unknown, source: unknown[]) => {
      summarySources.push(source);
      return 'safe-summary';
    },
  };
  const traceWriter = {
    writeEvents: async (_context: unknown, events: unknown[]) => {
      traceEvents.push(...events);
    },
    nextSequence: async () =>
      Math.max(
        -1,
        ...traceEvents.map((event) => {
          const sequence = (event as { sequence?: unknown }).sequence;
          return typeof sequence === 'number' ? sequence : -1;
        }),
      ) + 1,
  };
  const memoryReader = {
    readContext: async () => {
      if (options.failedReader === 'memory')
        throw new Error('controlled memory failure');
      return options.failedReader ? '可用文档' : '';
    },
  };
  const preferenceReader = {
    readContext: async () => {
      if (options.failedReader === 'preferences')
        throw new Error('controlled preference failure');
      return options.failedReader ? '可用偏好' : '';
    },
    listForChat: async (userId: string) => {
      assert.equal(userId, 'user-1');
      if (detailOutcome === 'preferences_unavailable')
        throw new Error('private preference failure');
      if (detailOutcome === 'preferences_disabled')
        return { ok: false, code: 'preferences_disabled' };
      const items =
        detailOutcome === 'preferences_empty'
          ? []
          : [
              {
                category: 'style',
                valueType: 'multi',
                value: { items: ['casual'] },
                isPrimary: true,
                updatedAt: '2026-11-16T00:00:00.000Z',
              },
            ];
      return {
        ok: true,
        items,
        page: 1,
        pageSize: 5,
        total: items.length,
        hasNext: false,
      };
    },
  };
  const memoryTasks = {
    enqueueInTransaction: async (transaction: unknown, input: unknown) => {
      assert.equal(transaction, manager);
      memoryEnqueued.push(input);
    },
  };
  const memoryLifecycle = { markConversationDeleted: async () => undefined };
  const emptyPurchaseState = {
    fingerprint: '',
    active: options.purchaseActive ?? false,
    context: '',
    reference: null,
  };
  const purchaseDrafts = {
    read: async (userId: string, conversationId: string) => {
      purchaseFormReads.push([userId, conversationId]);
      const status = options.purchaseFormStatus ?? null;
      return {
        draft: status ? { status } : null,
        order: null,
      };
    },
    runState: async () => emptyPurchaseState,
    runStateInTransaction: async () => emptyPurchaseState,
  };
  const displayService = new ChatDisplayService(
    {} as never,
    {
      getTryOnProducts: async () => new Map(),
    } as never,
  );
  displayService.bind = async (transaction, input) => {
    assert.equal(transaction, manager);
    if (options.failBind) throw new Error('display binding failed');
    bindings.push(input);
  };
  const service = new ChatRecordsService(
    conversationRepository as never,
    messageRepository as never,
    traceEventRepository as never,
    llmService as unknown as LlmService,
    contextService as unknown as ChatContextService,
    summaryService as never,
    traceWriter as never,
    memoryReader as never,
    memoryTasks as never,
    memoryLifecycle as never,
    displayService,
    preferenceReader as never,
    {} as never,
    purchaseDrafts as never,
    { lockOwnedInTransaction: async () => undefined } as never,
    {
      listForChat: async () => {
        if (detailOutcome === 'sku_unavailable')
          throw new Error('private catalog failure');
        if (detailOutcome === 'sku_not_found')
          return { ok: false, code: 'not_found' };
        const items =
          detailOutcome === 'sku_empty'
            ? []
            : [
                {
                  color: 'black',
                  size: 'M',
                  unitPrice: '99.00',
                  currency: 'CNY',
                  inStock: true,
                },
              ];
        return {
          ok: true,
          productExternalId: 'verified-shirt',
          items,
          page: 1,
          pageSize: 5,
          total: items.length,
          hasNext: false,
        };
      },
    } as never,
    undefined,
    options.tryOn,
    undefined,
    options.userInformation
      ? ({
          lookup: async () =>
            informationOutcome === 'unavailable'
              ? {
                  ok: true,
                  sections: {},
                  errors: [{ section: 'try_on_tasks', code: 'unavailable' }],
                }
              : {
                  ok: true,
                  sections:
                    informationOutcome === 'photos'
                      ? {}
                      : {
                          try_on_tasks: {
                            items:
                              informationOutcome === 'empty'
                                ? []
                                : [{ taskId: 'safe-reference' }],
                            page: 1,
                            pageSize: 5,
                            total: informationOutcome === 'empty' ? 0 : 1,
                          },
                        },
                  errors: [],
                },
        } as never)
      : undefined,
  );

  return {
    service,
    persisted,
    removed,
    modelInputs,
    modelExecutionOptions,
    registeredToolNames,
    purchaseFormReads,
    traceEvents,
    bindings,
    contextInputs,
    memoryEnqueued,
    summarySources,
  };
}

test('JSON/SSE 试穿查询成功、空和不可用均隔离整轮，下一普通轮恢复记忆资格', async () => {
  for (const stream of [false, true]) {
    for (const outcome of ['success', 'empty', 'unavailable'] as const) {
      const fixture = createService({
        userInformation: true,
        informationRequests: [outcome, 'none'],
      });
      const request = {
        messages: [{ role: 'user', content: '查询上次试穿，同时我喜欢宽松' }],
      };
      if (stream) {
        for await (const _event of await fixture.service.prepareStream(
          { id: 'user-1' } as never,
          request as never,
        )) {
          // 消费至 done，验证资格保存与公开展示绑定在完成前发生。
        }
      } else {
        await fixture.service.chat({ id: 'user-1' } as never, request as never);
      }
      const excluded = fixture.persisted
        .flat()
        .filter((value): value is ChatMessage => value instanceof ChatMessage);
      assert.equal(excluded.length, 2);
      assert.ok(
        excluded.every((message) => message.memoryExtractionEligible === false),
      );
      assert.equal(fixture.memoryEnqueued.length, 0);
      assert.equal(fixture.bindings.length, 1);
      await fixture.service.chat(
        { id: 'user-1' } as never,
        { messages: [{ role: 'user', content: '我喜欢宽松外套' }] } as never,
      );
      const messages = fixture.persisted
        .flat()
        .filter((value): value is ChatMessage => value instanceof ChatMessage);
      assert.ok(
        messages.slice(-2).every((message) => message.memoryExtractionEligible),
      );
      assert.equal(fixture.memoryEnqueued.length, 1);
    }
  }
});

test('JSON/SSE 规格和偏好查询各种结果均隔离整轮，下一普通轮恢复', async () => {
  const outcomes: DetailRequest[] = [
    'sku',
    'sku_empty',
    'sku_not_found',
    'sku_unavailable',
    'preferences',
    'preferences_empty',
    'preferences_disabled',
    'preferences_unavailable',
  ];
  for (const stream of [false, true]) {
    for (const outcome of outcomes) {
      const fixture = createService({ detailRequests: [outcome, 'none'] });
      const request = {
        messages: [{ role: 'user', content: '查询明细，同时我喜欢宽松' }],
      };
      if (stream) {
        for await (const _event of await fixture.service.prepareStream(
          { id: 'user-1' } as never,
          request as never,
        )) {
          // 消费至 done，验证保存完成后整轮来源资格已经生效。
        }
      } else {
        await fixture.service.chat({ id: 'user-1' } as never, request as never);
      }
      const excluded = fixture.persisted
        .flat()
        .filter((value): value is ChatMessage => value instanceof ChatMessage);
      assert.equal(excluded.length, 2, outcome);
      assert.ok(
        excluded.every((message) => !message.memoryExtractionEligible),
        outcome,
      );
      assert.equal(fixture.memoryEnqueued.length, 0, outcome);
      await fixture.service.chat(
        { id: 'user-1' } as never,
        { messages: [{ role: 'user', content: '我喜欢宽松外套' }] } as never,
      );
      const messages = fixture.persisted
        .flat()
        .filter((value): value is ChatMessage => value instanceof ChatMessage);
      assert.ok(
        messages.slice(-2).every((message) => message.memoryExtractionEligible),
      );
      assert.equal(fixture.memoryEnqueued.length, 1);
    }
  }
});

test('摘要服务实际接线过滤不同模型 ID 的试穿和未绑定运行，仅接收普通轮次', async () => {
  const history = {
    messages: [
      Object.assign(new ChatMessage(), {
        id: 'db-excluded',
        memoryExtractionEligible: false,
      }),
      Object.assign(new ChatMessage(), {
        id: 'db-ordinary',
        memoryExtractionEligible: true,
      }),
    ],
    traces: [
      Object.assign(new ChatTraceEvent(), {
        runId: 'try-on',
        sequence: 0,
        eventType: 'input',
        messageId: 'model-human-excluded',
        content: '查询上次试穿',
        payload: {},
      }),
      Object.assign(new ChatTraceEvent(), {
        runId: 'try-on',
        sequence: 1,
        eventType: 'model_response',
        messageId: 'model-ai-excluded',
        content: '任务处理中',
        payload: { publicDisplay: { assistantMessageId: 'db-excluded' } },
      }),
      Object.assign(new ChatTraceEvent(), {
        runId: 'ordinary',
        sequence: 0,
        eventType: 'input',
        messageId: 'model-human-ordinary',
        content: '喜欢棉质',
        payload: {},
      }),
      Object.assign(new ChatTraceEvent(), {
        runId: 'ordinary',
        sequence: 1,
        eventType: 'model_response',
        messageId: 'model-ai-ordinary',
        content: '棉质舒适',
        payload: { publicDisplay: { assistantMessageId: 'db-ordinary' } },
      }),
      Object.assign(new ChatTraceEvent(), {
        runId: 'unbound',
        sequence: 0,
        eventType: 'input',
        messageId: 'model-unbound',
        content: '失败轮次',
        payload: {},
      }),
    ],
  };
  const fixture = createService({ summaryHistory: history });
  await fixture.service.chat(
    { id: 'user-1' } as never,
    {
      conversationId: 'existing-conversation',
      messages: [{ role: 'user', content: '继续聊天' }],
    } as never,
  );
  assert.equal(fixture.summarySources.length, 1);
  assert.deepEqual(
    (fixture.summarySources[0] as ChatHistoryMessage[]).map(
      (message) => message.id,
    ),
    ['model-human-ordinary', 'model-ai-ordinary'],
  );
});

test('原图片查询保留记忆资格，已有购买隔离条件继续生效', async () => {
  for (const purchaseActive of [false, true]) {
    const fixture = createService({
      userInformation: true,
      informationRequests: ['photos'],
      purchaseActive,
    });
    await fixture.service.chat(
      { id: 'user-1' } as never,
      {
        ...(purchaseActive ? { conversationId: 'existing-conversation' } : {}),
        messages: [{ role: 'user', content: '我的已保存图片' }],
      } as never,
    );
    const messages = fixture.persisted
      .flat()
      .filter((value): value is ChatMessage => value instanceof ChatMessage);
    assert.ok(
      messages.every(
        (message) => message.memoryExtractionEligible === !purchaseActive,
      ),
    );
    assert.equal(fixture.memoryEnqueued.length, purchaseActive ? 0 : 1);
  }
});

test('持久化聊天仅将系统上下文传给模型，不写入消息或响应', async () => {
  const { service, persisted, modelInputs } = createService();
  const result = await service.chat(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '你好' }],
    } as never,
  );

  assert.deepEqual(modelInputs, [
    {
      messages: [
        { role: 'system', content: '服务端上下文' },
        { role: 'user', content: '你好' },
      ],
    },
  ]);
  assert.equal(JSON.stringify(persisted).includes('服务端上下文'), false);
  assert.equal(JSON.stringify(result).includes('服务端上下文'), false);
});

test('标题生成会压缩空白并按 Unicode 字符截断', () => {
  const service = Object.create(
    ChatRecordsService.prototype,
  ) as ChatRecordsService;

  assert.equal(
    service.generateConversationTitle('  春夏   穿搭\n推荐  '),
    '春夏 穿搭 推荐',
  );
  assert.equal(
    service.generateConversationTitle('😀'.repeat(31)),
    `${'😀'.repeat(30)}...`,
  );
});

test('分页 DTO 缺省值和非法运行时值会回退到安全范围', () => {
  const pagination = Object.assign(new PaginationDto(), {
    page: undefined,
    pageSize: undefined,
  }) as unknown as PaginationDto;

  assert.equal(pagination.normalizedPage, 1);
  assert.equal(pagination.normalizedPageSize, 20);
  assert.equal(pagination.offset, 0);
});

test('流式聊天先产出增量，事务提交后才发送 done', async () => {
  const { service, persisted } = createService();
  const events = await service.prepareStream(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '你好' }],
    } as never,
  );
  const received: Array<{ type: string; content?: string }> = [];

  for await (const event of events) {
    received.push(event);
    if (event.type === 'delta') {
      assert.equal(persisted.length, 1);
    }
    if (event.type === 'done') {
      assert.equal(persisted.length, 3);
      const conversation = persisted[1] as ChatConversation;
      const messages = persisted[2] as ChatMessage[];
      assert.equal(conversation.title, '你好');
      assert.deepEqual(
        messages.map((message) => [message.role, message.content]),
        [
          ['user', '你好'],
          ['assistant', '第一段第二段'],
        ],
      );
    }
  }

  assert.deepEqual(
    received.map((event) => event.type),
    ['start', 'delta', 'delta', 'done'],
  );
});

test('新会话在流式取消后删除，避免留下空会话', async () => {
  const { service, removed } = createService();
  const abortController = new AbortController();
  const events = await service.prepareStream(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '你好' }],
    } as never,
    abortController.signal,
  );

  await assert.rejects(
    (async () => {
      for await (const event of events) {
        if (event.type === 'start') {
          abortController.abort();
        }
      }
    })(),
    { name: 'AbortError' },
  );
  assert.equal(removed.length, 1);
  assert.equal((removed[0] as ChatConversation).title, '你好');
});

test('流式聊天事务失败时不会发送 done', async () => {
  const { service } = createService({ failFlush: true });
  const events = await service.prepareStream(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '你好' }],
    } as never,
  );
  const received: string[] = [];

  await assert.rejects(
    (async () => {
      for await (const event of events) {
        received.push(event.type);
      }
    })(),
    /database failure/u,
  );
  assert.deepEqual(received, ['start', 'delta', 'delta']);
});

test('工具展示按稳定 ID 更新，最终模型事件绑定与正文保存共用事务', async () => {
  const { service, bindings } = createService({ tools: true });
  const events = await service.prepareStream(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '你好' }],
    } as never,
  );
  const received = [];
  for await (const event of events) {
    received.push(event);
    if (event.type === 'done') assert.equal(bindings.length, 1);
  }
  assert.deepEqual(
    received.map((event) => event.type),
    ['start', 'delta', 'activity', 'activity', 'delta', 'done'],
  );
  assert.equal(JSON.stringify(received).includes('private'), false);
  assert.equal((bindings[0] as { sequence: number }).sequence, 4);
  const done = received.at(-1);
  assert.equal(
    done?.type === 'done' && done.context?.contextWindowTokens,
    8192,
  );
  assert.equal(done?.type === 'done' && done.context?.usedTokens, null);
});

test('聊天运行时注册统一用户信息和动态表单工具，不再注册旧地址工具', async () => {
  const { service, registeredToolNames } = createService({
    userInformation: true,
  });
  const events = await service.prepareStream(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '查询我的默认地址' }],
    } as never,
  );
  for await (const _event of events) {
    // 消费流以触发运行时工具组装。
  }

  const names = registeredToolNames.at(-1) ?? [];
  assert.ok(names.includes('get_my_information'));
  assert.ok(names.includes('request_dynamic_form'));
  assert.ok(names.includes('request_purchase_form'));
  assert.equal(names.includes('list_my_shipping_addresses'), false);
  assert.equal(names.includes('select_my_shipping_address'), false);
});

test('购买表单请求仅在本人草稿可编辑时发送一次性 SSE 事件', async () => {
  const { service, purchaseFormReads } = createService({
    purchaseForm: true,
    repeatPurchaseForm: true,
    purchaseFormStatus: 'collecting',
  });
  const events = await service.prepareStream(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '打开本次购买表单' }],
    } as never,
  );
  const received = [];
  for await (const event of events) received.push(event);

  const start = received.find((event) => event.type === 'start');
  assert.ok(start?.type === 'start');
  assert.deepEqual(purchaseFormReads, [
    ['user-1', start.conversationId],
    ['user-1', start.conversationId],
  ]);
  assert.equal(
    received.filter((event) => event.type === 'purchase-form').length,
    1,
  );
  assert.deepEqual(
    received.find((event) => event.type === 'purchase-form'),
    { type: 'purchase-form' },
  );
  assert.equal(JSON.stringify(received).includes('recipient'), false);
});

test('没有可编辑草稿或草稿已终止时不发送购买表单事件', async () => {
  for (const purchaseFormStatus of [null, 'submitted'] as const) {
    const { service } = createService({
      purchaseForm: true,
      purchaseFormStatus,
    });
    const events = await service.prepareStream(
      { id: 'user-1' } as never,
      {
        messages: [{ role: 'user', content: '打开本次购买表单' }],
      } as never,
    );
    const received = [];
    for await (const event of events) received.push(event);
    assert.equal(
      received.some((event) => event.type === 'purchase-form'),
      false,
    );
  }
});

test('JSON 聊天不注册仅适用于 SSE 的购买表单请求工具', async () => {
  const { service, registeredToolNames } = createService({
    purchaseFormStatus: 'ready',
  });
  await service.chat(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '打开购买弹框' }],
    } as never,
  );

  assert.equal(
    registeredToolNames.at(-1)?.includes('request_purchase_form'),
    false,
  );
});

test('待付款候选 SSE 事件与最终 assistant 消息展示绑定一致', async () => {
  const { service, bindings } = createService({ cancellationCandidates: true });
  const events = await service.prepareStream(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '我想取消订单' }],
    } as never,
  );
  const received = [];
  for await (const event of events) received.push(event);

  const candidateEvent = received.find(
    (event) => event.type === 'order-cancellation-candidates',
  );
  assert.equal(candidateEvent?.type, 'order-cancellation-candidates');
  if (candidateEvent?.type !== 'order-cancellation-candidates') {
    assert.fail('缺少订单候选展示事件');
  }
  assert.equal(
    candidateEvent.orderCancellationCandidates[0]?.orderNo,
    'ORD-20261110-001',
  );
  assert.equal(JSON.stringify(candidateEvent).includes('recipient'), false);
  assert.equal(bindings.length, 1);
  const boundData = (
    bindings[0] as { data: { orderCancellationCandidates: unknown[] } }
  ).data;
  assert.deepEqual(
    boundData.orderCancellationCandidates,
    candidateEvent.orderCancellationCandidates,
  );
  assert.equal(received.at(-1)?.type, 'done');
});

test('展示绑定失败或最终 trace 缺失时拒绝完成，不发 done', async () => {
  for (const options of [{ failBind: true }, { missingTrace: true }]) {
    const { service } = createService(options);
    const events = await service.prepareStream(
      { id: 'user-1' } as never,
      {
        messages: [{ role: 'user', content: '你好' }],
      } as never,
    );
    const received: string[] = [];
    await assert.rejects(async () => {
      for await (const event of events) received.push(event.type);
    });
    assert.equal(received.includes('done'), false);
  }
});

test('归属校验失败时不查询消息或公开展示元数据', async () => {
  const { service } = createService();
  await assert.rejects(
    service.getForUser('other-user', 'missing-id', new PaginationDto()),
    { status: 404 },
  );
});

test('任一上下文读取失败仅跳过该领域，另一来源继续进入模型上下文', async () => {
  for (const failedReader of ['preferences', 'memory'] as const) {
    const { service, contextInputs } = createService({ failedReader });
    await service.chat(
      { id: 'user-1' } as never,
      { messages: [{ role: 'user', content: '推荐服装' }] } as never,
    );
    assert.equal(
      contextInputs[0]?.memoryContext,
      failedReader === 'preferences' ? '可用文档' : '可用偏好',
    );
  }
});

test('聊天动作只调用一次试穿工具，图片仅作为临时模型输入且不进入 trace 或历史', async () => {
  const image = Buffer.from('synthetic-image-bytes');
  const calls: unknown[] = [];
  const { service, persisted, modelExecutionOptions, traceEvents } =
    createService({
      tryOn: {
        run: async (input) => {
          calls.push(input);
          return {
            status: 'succeeded',
            result: {
              taskId: '33333333-3333-4333-8333-333333333333',
              product: {
                externalId: 'coat-1',
                name: '试穿大衣',
                color: '黑色',
              },
              result: {
                width: 1200,
                height: 1600,
                mimeType: 'image/webp',
              },
              image,
            },
          };
        },
        canReadResult: async () => true,
      },
    });

  const result = await service.chat(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '帮我试穿' }],
      tryOnAction: {
        productExternalId: 'coat-1',
        color: '黑色',
        photoId: '22222222-2222-4222-8222-222222222222',
        consentVersion: 'private-consent-version',
      },
    } as never,
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    userId: 'user-1',
    productExternalId: 'coat-1',
    color: '黑色',
    photoId: '22222222-2222-4222-8222-222222222222',
    consentVersion: 'private-consent-version',
  });
  const execution = modelExecutionOptions[0] as {
    traceSequence: number;
    skipPersistInput: boolean;
    ephemeralModelMessages: Array<{ content: unknown }>;
  };
  assert.equal(execution.traceSequence, 3);
  assert.equal(execution.skipPersistInput, true);
  const imageMessage = execution.ephemeralModelMessages[0]!;
  assert.equal(
    JSON.stringify(imageMessage.content).includes(image.toString('base64')),
    true,
  );
  assert.equal(
    result.tryOnResult?.taskId,
    '33333333-3333-4333-8333-333333333333',
  );

  const persistedJson = JSON.stringify(persisted);
  const traceJson = JSON.stringify(traceEvents);
  for (const serialized of [persistedJson, traceJson]) {
    assert.equal(serialized.includes('private-consent-version'), false);
    assert.equal(
      serialized.includes('22222222-2222-4222-8222-222222222222'),
      false,
    );
    assert.equal(serialized.includes(image.toString('base64')), false);
    assert.equal(serialized.includes('synthetic-image-bytes'), false);
  }
});

test('流式试穿状态回调先于任务完成时仍发送 queued 状态事件', async () => {
  const { service } = createService({
    tryOn: {
      run: async (input) => {
        input.onStatus?.({
          taskId: '33333333-3333-4333-8333-333333333333',
          status: 'queued',
        });
        return {
          status: 'failed',
          taskId: '33333333-3333-4333-8333-333333333333',
          code: 'PROVIDER_REJECTED',
        };
      },
      canReadResult: async () => false,
    },
  });

  const events = await service.prepareStream(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '帮我试穿' }],
      tryOnAction: {
        productExternalId: 'coat-1',
        color: '黑色',
        photoId: '22222222-2222-4222-8222-222222222222',
        consentVersion: 'v1',
      },
    } as never,
  );
  const received = [];
  for await (const event of events) received.push(event);

  assert.deepEqual(
    received.map((event) => event.type),
    ['start', 'try-on-status', 'delta', 'done'],
  );
  assert.deepEqual(received[1], {
    type: 'try-on-status',
    taskId: '33333333-3333-4333-8333-333333333333',
    status: 'queued',
  });
  const done = received.at(-1);
  assert.equal(done?.type === 'done' && done.tryOnStatus?.status, 'failed');
});

test('试穿图片已生成但聊天模型失败时保存安全降级回复和失败 trace', async () => {
  const { service, traceEvents } = createService({
    modelFailure: true,
    tryOn: {
      run: async () => ({
        status: 'succeeded',
        result: {
          taskId: '33333333-3333-4333-8333-333333333333',
          product: {
            externalId: 'coat-1',
            name: '试穿大衣',
            color: '黑色',
          },
          result: {
            width: 1200,
            height: 1600,
            mimeType: 'image/webp',
          },
          image: Buffer.from('synthetic-image-bytes'),
        },
      }),
      canReadResult: async () => true,
    },
  });

  const result = await service.chat(
    { id: 'user-1' } as never,
    {
      messages: [{ role: 'user', content: '帮我试穿' }],
      tryOnAction: {
        productExternalId: 'coat-1',
        color: '黑色',
        photoId: '22222222-2222-4222-8222-222222222222',
        consentVersion: 'v1',
      },
    } as never,
  );

  assert.equal(
    result.content,
    '试穿结果已生成，但暂时无法生成文字回复。你可以直接查看结果图。',
  );
  assert.equal(
    result.tryOnResult?.taskId,
    '33333333-3333-4333-8333-333333333333',
  );
  assert.equal(
    traceEvents.some(
      (event) =>
        (event as { status?: string }).status === 'failed' &&
        (event as { payload?: { origin?: string } }).payload?.origin ===
          'server_fallback',
    ),
    true,
  );
  assert.equal(
    JSON.stringify(traceEvents).includes('synthetic-image-bytes'),
    false,
  );
});
