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
import { PaginationDto } from '../dto/pagination.dto.js';

function createService(
  options: {
    failFlush?: boolean;
    failBind?: boolean;
    missingTrace?: boolean;
    tools?: boolean;
    failedReader?: 'preferences' | 'memory';
  } = {},
) {
  const persisted: unknown[] = [];
  const removed: unknown[] = [];
  const modelInputs: unknown[] = [];
  const bindings: unknown[] = [];
  const contextInputs: Array<{ memoryContext?: string }> = [];
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
      return persisted.find(
        (item) => item instanceof ChatConversation,
      ) as ChatConversation;
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
    findOne: async () => null,
    getEntityManager: () => manager,
  };
  const messageRepository = {
    find: async () => [],
  };
  const traceEventRepository = {
    find: async () => [],
  };
  const llmService = {
    assertConfigured: () => 'fake-model',
    chatPrepared: async (input: unknown) => {
      modelInputs.push(input);
      return {
        content: '回复',
        model: 'fake-model',
        usage: null,
        finalTraceSequence: 4,
      };
    },
    async *streamEventsPrepared(): AsyncGenerator<
      LlmStreamEvent,
      LlmEventStreamResult
    > {
      yield { type: 'delta', content: '第一段' };
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
    prepare: (input: { memoryContext?: string }) => {
      contextInputs.push(input);
      return {
        messages: [
          { role: 'system' as const, content: '服务端上下文' },
          { role: 'user' as const, content: '你好' },
        ],
        needsSummary: false,
        summarySource: [],
        lastIncludedMessageId: null,
        hardLimit: 100,
      };
    },
  };
  const summaryService = { summarize: async () => null };
  const traceWriter = { writeEvents: async () => undefined };
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
  };
  const memoryTasks = { enqueueInTransaction: async () => undefined };
  const memoryLifecycle = { markConversationDeleted: async () => undefined };
  const emptyPurchaseState = {
    fingerprint: '',
    active: false,
    context: '',
    reference: null,
  };
  const displayService = new ChatDisplayService({} as never);
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
    {
      runState: async () => emptyPurchaseState,
      runStateInTransaction: async () => emptyPurchaseState,
    } as never,
    { lockOwnedInTransaction: async () => undefined } as never,
  );

  return { service, persisted, removed, modelInputs, bindings, contextInputs };
}

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
