import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';

import { memoryCandidateSchema } from '../context/memory-candidate.schema.js';
import {
  memoryDocumentOperationsSchema,
  type MemoryDocumentOperation,
} from '../context/memory-document-patch.schema.js';
import { UserMemoryExtractorService } from '../service/user-memory-extractor.service.js';
import { UserMemoryTaskService } from '../service/user-memory-task.service.js';
import {
  UserMemoryTask,
  UserMemoryTaskStatus,
} from '../entity/user-memory-task.entity.js';

const operation = {
  operation: 'append' as const,
  section: 'clothing' as const,
  markdown: '偏好天然棉质面料',
  explicit: true as const,
};

function fixture(
  options: {
    userMessage?: string;
    operations?: MemoryDocumentOperation[];
    currentDocument?: string;
    sourceTurns?: Array<{
      userMessageId: string;
      assistantMessageId: string;
    }> | null;
    availableTurns?: Array<{
      userMessageId: string;
      assistantMessageId: string;
      userMessage: string;
      assistantMessage: string;
    }>;
    onGenerate?: () => void;
  } = {},
) {
  const task = Object.assign(new UserMemoryTask(), {
    id: 'task',
    userId: 'user',
    conversationId: 'conversation',
    userMessageId: 'user-message',
    assistantMessageId: 'assistant-message',
    sourceTurns: options.sourceTurns ?? null,
    lockedAt: new Date(),
    attempts: 1,
    status: UserMemoryTaskStatus.PROCESSING,
  });
  let allowed = true;
  let generated = 0;
  let applied = 0;
  let sourceReads = 0;
  let failApply = false;
  let sourceAvailable = true;
  let availableTurns = options.availableTurns ?? [
    {
      userMessageId: 'user-message',
      assistantMessageId: 'assistant-message',
      userMessage: options.userMessage ?? '我长期喜欢棉质衣物',
      assistantMessage: '好的',
    },
  ];
  let modelInput = '';
  let systemPrompt = '';
  let appliedOperations: MemoryDocumentOperation[] = [];
  const cloneTask = () =>
    Object.assign(new UserMemoryTask(), {
      ...task,
      sourceTurns: task.sourceTurns ? [...task.sourceTurns] : null,
      candidateOperations: task.candidateOperations
        ? [...task.candidateOperations]
        : null,
    });
  const service = new UserMemoryExtractorService(
    {
      generate: async (input: { user: string; system: string }) => {
        generated++;
        modelInput = input.user;
        systemPrompt = input.system;
        options.onGenerate?.();
        return {
          content: JSON.stringify({
            operations: options.operations ?? [operation],
          }),
        };
      },
    } as never,
    {
      readCurrent: async () => (allowed ? cloneTask() : null),
      saveCandidates: async (
        currentTask: unknown,
        operations: typeof task.candidateOperations,
      ) => {
        if (!allowed) return false;
        task.candidateOperations = operations;
        if (currentTask instanceof UserMemoryTask)
          currentTask.candidateOperations = operations;
        return true;
      },
      normalizeSources: async (
        _currentTask: unknown,
        turns: Array<{ userMessageId: string; assistantMessageId: string }>,
      ) => {
        const previous =
          task.sourceTurns ??
          (task.userMessageId && task.assistantMessageId
            ? [
                {
                  userMessageId: task.userMessageId,
                  assistantMessageId: task.assistantMessageId,
                },
              ]
            : []);
        if (
          task.sourceTurns === null ||
          JSON.stringify(previous) !== JSON.stringify(turns)
        ) {
          task.sourceTurns = turns;
          task.candidateOperations = null;
        }
        return cloneTask();
      },
    } as never,
    {
      readTurn: async () => {
        sourceReads++;
        if (!sourceAvailable) return null;
        return {
          userMessage: options.userMessage ?? '我长期喜欢棉质衣物',
          assistantMessage: '好的',
        };
      },
      readTurns: async ({
        turns,
      }: {
        turns: Array<{ userMessageId: string; assistantMessageId: string }>;
      }) => {
        sourceReads++;
        if (!sourceAvailable) return null;
        const requested = new Set(
          turns.map(
            (turn) => `${turn.userMessageId}:${turn.assistantMessageId}`,
          ),
        );
        return availableTurns.filter((turn) =>
          requested.has(`${turn.userMessageId}:${turn.assistantMessageId}`),
        );
      },
    } as never,
    {
      get: async () => ({
        content: options.currentDocument ?? '已有的衣物记忆',
        revision: 0,
        updatedAt: null,
      }),
      applyExtractedOperations: async (input: {
        taskAttempts: number;
        taskLockedAt: Date;
        operations: MemoryDocumentOperation[];
      }) => {
        assert.equal(input.taskAttempts, task.attempts);
        assert.equal(input.taskLockedAt, task.lockedAt);
        if (failApply) throw new ServiceUnavailableException();
        applied++;
        appliedOperations = input.operations;
      },
    } as never,
  );
  return {
    service,
    task,
    disable: () => {
      allowed = false;
    },
    failApply: (value: boolean) => {
      failApply = value;
    },
    invalidateSource: () => {
      sourceAvailable = false;
    },
    setAvailableTurns: (turns: typeof availableTurns) => {
      availableTurns = turns;
    },
    counts: () => ({ generated, applied, sourceReads }),
    modelInput: () => modelInput,
    systemPrompt: () => systemPrompt,
    appliedOperations: () => appliedOperations,
  };
}

test('记忆关闭或租约无效时不读取聊天也不调用模型', async () => {
  const f = fixture();
  f.disable();
  await f.service.process(f.task);
  assert.deepEqual(f.counts(), { generated: 0, applied: 0, sourceReads: 0 });
});

test('提取提示放宽明确自述门槛，同时保留时间范围和隐私限制', async () => {
  const f = fixture();
  await f.service.process(f.task);
  const prompt = f.systemPrompt();
  for (const term of [
    '开放文本',
    '不要求用户说出“长期”“经常”或重复表达',
    '季节',
    '城市/行政区',
    '气候',
    '常住情况未确认',
    '近期穿衣倾向',
    '今天想穿休闲',
    '单次天气',
    '旅行地点不能覆盖常住城市',
    'IP',
    '详细地址',
    '不得输出结构化偏好',
  ])
    assert.ok(prompt.includes(term), term);
});

test('所在地与近期倾向候选沿用补丁链路，生成输入保留已有常住信息', async () => {
  const currentDocument = '用户常住杭州';
  const operations: MemoryDocumentOperation[] = [
    {
      ...operation,
      markdown: '用户曾表示目前在广州海珠区，常住情况未确认',
    },
    {
      ...operation,
      markdown: '用户曾表达近期穿衣倾向为休闲，未确认长期偏好',
    },
  ];
  const userMessage = '我在广州海珠区，25度，有点下雨，我想穿休闲一点';
  const f = fixture({ userMessage, currentDocument, operations });
  await f.service.process(f.task);
  const input = JSON.parse(f.modelInput());
  assert.equal(input.turns[0].userMessage, userMessage);
  assert.equal(input.currentDocument, currentDocument);
  assert.deepEqual(f.task.candidateOperations, operations);
  assert.deepEqual(f.appliedOperations(), operations);
});

test('没有适合保存的信息时允许空候选，不补写用户事实', async () => {
  const f = fixture({
    userMessage: '今天25度有小雨，今天想穿休闲，有衣服推荐吗',
    operations: [],
  });
  await f.service.process(f.task);
  assert.deepEqual(f.task.candidateOperations, []);
  assert.deepEqual(f.appliedOperations(), []);
  assert.deepEqual(f.counts(), { generated: 1, applied: 1, sourceReads: 3 });
});

test('记忆候选仅接受文档补丁并拒绝偏好、敏感信息和未知字段', () => {
  assert.equal(
    memoryCandidateSchema.parse({ operations: [operation] }).operations.length,
    1,
  );
  for (const candidate of [
    { operations: [], documentOperations: [] },
    {
      operations: [
        {
          operation: 'upsert',
          category: 'style',
          value: { items: ['基础款'] },
          explicit: true,
        },
      ],
    },
    { operations: [{ ...operation, explicit: false }] },
    { operations: [{ ...operation, markdown: '手机号 13812345678' }] },
    { operations: [], fullDocument: '# 覆盖文档' },
  ])
    assert.equal(memoryCandidateSchema.safeParse(candidate).success, false);
  assert.equal(
    memoryDocumentOperationsSchema.safeParse(Array(11).fill(operation)).success,
    false,
  );
});

test('候选持久化后应用失败，重试复用候选而不再次生成', async () => {
  const f = fixture();
  f.failApply(true);
  await assert.rejects(f.service.process(f.task), ServiceUnavailableException);
  assert.deepEqual(f.task.candidateOperations, [operation]);
  f.failApply(false);
  await f.service.process(f.task);
  assert.deepEqual(f.counts(), { generated: 1, applied: 1, sourceReads: 5 });
  assert.equal(JSON.parse(f.modelInput()).currentDocument, '已有的衣物记忆');
});

test('缓存候选重试仍检查用户与消息来源，来源失效时不再生成或写入文档', async () => {
  const f = fixture();
  f.failApply(true);
  await assert.rejects(f.service.process(f.task), ServiceUnavailableException);
  assert.deepEqual(f.task.candidateOperations, [operation]);
  f.failApply(false);
  f.invalidateSource();
  await f.service.process(f.task);
  assert.deepEqual(f.counts(), { generated: 1, applied: 0, sourceReads: 4 });
});

test('混合批次只把合法来源送给模型，全部被过滤时不调用模型', async () => {
  const sourceTurns = [
    { userMessageId: 'user-1', assistantMessageId: 'assistant-1' },
    { userMessageId: 'user-2', assistantMessageId: 'assistant-2' },
  ];
  const f = fixture({
    sourceTurns,
    availableTurns: [
      {
        ...sourceTurns[1]!,
        userMessage: '我喜欢宽松版型',
        assistantMessage: '记下了',
      },
    ],
  });
  await f.service.process(f.task);
  assert.deepEqual(f.task.sourceTurns, [sourceTurns[1]]);
  assert.deepEqual(JSON.parse(f.modelInput()).turns, [
    { userMessage: '我喜欢宽松版型', assistantMessage: '记下了' },
  ]);
  assert.equal(f.counts().generated, 1);

  const empty = fixture({ sourceTurns, availableTurns: [] });
  await empty.service.process(empty.task);
  assert.deepEqual(empty.task.sourceTurns, []);
  assert.equal(empty.counts().generated, 0);
  assert.equal(empty.counts().applied, 0);
});

test('来源集合变化时清除候选缓存并只对新合法来源重新生成', async () => {
  const sourceTurns = [
    { userMessageId: 'user-1', assistantMessageId: 'assistant-1' },
    { userMessageId: 'user-2', assistantMessageId: 'assistant-2' },
  ];
  const f = fixture({
    sourceTurns,
    availableTurns: sourceTurns.map((turn, index) => ({
      ...turn,
      userMessage: `合法来源 ${index + 1}`,
      assistantMessage: '已收到',
    })),
  });
  f.failApply(true);
  await assert.rejects(f.service.process(f.task), ServiceUnavailableException);
  assert.equal(f.counts().generated, 1);
  f.failApply(false);
  f.setAvailableTurns([
    {
      ...sourceTurns[1]!,
      userMessage: '剩余合法来源',
      assistantMessage: '继续',
    },
  ]);
  await f.service.process(f.task);
  assert.equal(f.counts().generated, 2);
  assert.deepEqual(JSON.parse(f.modelInput()).turns, [
    { userMessage: '剩余合法来源', assistantMessage: '继续' },
  ]);
});

test('模型生成期间来源集合变化时清除候选并要求租约重试', async () => {
  const sourceTurns = [
    { userMessageId: 'user-1', assistantMessageId: 'assistant-1' },
    { userMessageId: 'user-2', assistantMessageId: 'assistant-2' },
  ];
  let f: ReturnType<typeof fixture>;
  f = fixture({
    sourceTurns,
    availableTurns: sourceTurns.map((turn, index) => ({
      ...turn,
      userMessage: `合法来源 ${index + 1}`,
      assistantMessage: '已收到',
    })),
    onGenerate: () =>
      f.setAvailableTurns([
        {
          ...sourceTurns[1]!,
          userMessage: '变化后的合法来源',
          assistantMessage: '继续',
        },
      ]),
  });
  let sourceChangeError: unknown;
  try {
    await f.service.process(f.task);
  } catch (error) {
    sourceChangeError = error;
  }
  assert.equal(f.service.getFailureCode(sourceChangeError), 'SOURCE_CHANGED');
  assert.equal(f.task.candidateOperations, null);
  f.setAvailableTurns([
    {
      ...sourceTurns[1]!,
      userMessage: '变化后的合法来源',
      assistantMessage: '继续',
    },
  ]);
  await f.service.process(f.task);
  assert.equal(f.counts().generated, 2);
  assert.deepEqual(JSON.parse(f.modelInput()).turns, [
    { userMessage: '变化后的合法来源', assistantMessage: '继续' },
  ]);
});

test('区分模型输出、存储故障和数据库故障，不输出未知异常正文', () => {
  const { service } = fixture();
  assert.equal(service.getFailureCode(new SyntaxError()), 'INVALID_OUTPUT');
  assert.equal(
    service.getFailureCode(new ServiceUnavailableException()),
    'STORAGE_UNAVAILABLE',
  );
  assert.equal(service.getFailureCode({ code: '40001' }), 'DATABASE_RETRYABLE');
  assert.equal(
    service.getFailureCode(new Error('private')),
    'EXTRACTION_FAILED',
  );
});

test('登记取得文档锁后先检查独立开关，再捕获清空代次', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const created: Array<Record<string, unknown>> = [];
  let flushes = 0;
  let updates = 0;
  const manager = {
    getTransactionContext: () => undefined,
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return [];
      },
    }),
    findOne: async () => null,
    create: (_entity: unknown, input: Record<string, unknown>) => {
      created.push(input);
      return input;
    },
    flush: async () => {
      flushes++;
    },
    nativeUpdate: async () => {
      updates++;
    },
  };
  await new UserMemoryTaskService(
    {} as never,
    {} as never,
  ).enqueueInTransaction(manager as never, {
    userId: 'user',
    conversationId: 'conversation',
    userMessageId: 'message',
    assistantMessageId: 'reply',
  });
  assert.match(queries[0]!.sql, /pg_advisory_xact_lock/);
  assert.deepEqual(queries[0]!.params, ['user-memory-document:user']);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.documentGeneration, 0);
  assert.ok(created[0]?.availableAt instanceof Date);
  assert.equal(flushes, 1);
  assert.equal(updates, 1);
});
