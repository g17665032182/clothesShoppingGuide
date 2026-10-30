import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatOutput, LlmService } from '../../llm/service/llm.service.js';
import { ChatRecordsService } from '../service/chat-records.service.js';
import { ChatContextService } from '../context/chat-context.service.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import { ChatMessage } from '../entity/chat-message.entity.js';
import { PaginationDto } from '../dto/pagination.dto.js';

function createService(options: { failFlush?: boolean } = {}) {
  const persisted: unknown[] = [];
  const removed: unknown[] = [];
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
    async *stream(): AsyncGenerator<string, ChatOutput> {
      yield '第一段';
      yield '第二段';
      return {
        content: '第一段第二段',
        model: 'fake-model',
        usage: null,
      };
    },
  };
  const contextService = {
    prepare: () => ({
      messages: [{ role: 'user' as const, content: '你好' }],
      needsSummary: false,
      summarySource: [],
      lastIncludedMessageId: null,
      hardLimit: 100,
    }),
  };
  const summaryService = { summarize: async () => null };
  const traceWriter = { writeEvents: async () => undefined };
  const service = new ChatRecordsService(
    conversationRepository as never,
    messageRepository as never,
    traceEventRepository as never,
    llmService as unknown as LlmService,
    contextService as unknown as ChatContextService,
    summaryService as never,
    traceWriter as never,
  );

  return { service, persisted, removed };
}

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
