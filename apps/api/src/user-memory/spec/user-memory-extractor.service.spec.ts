import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';

import { memoryCandidateSchema } from '../context/memory-candidate.schema.js';
import { memoryDocumentOperationsSchema } from '../context/memory-document-patch.schema.js';
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

function fixture() {
  const task = Object.assign(new UserMemoryTask(), {
    id: 'task',
    userId: 'user',
    conversationId: 'conversation',
    userMessageId: 'user-message',
    assistantMessageId: 'assistant-message',
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
  let modelInput = '';
  const service = new UserMemoryExtractorService(
    {
      generate: async (input: { user: string }) => {
        generated++;
        modelInput = input.user;
        return { content: JSON.stringify({ operations: [operation] }) };
      },
    } as never,
    {
      readCurrent: async () => (allowed ? task : null),
      saveCandidates: async (
        _task: unknown,
        operations: typeof task.candidateOperations,
      ) => {
        if (!allowed) return false;
        task.candidateOperations = operations;
        return true;
      },
    } as never,
    {
      readTurn: async () => {
        sourceReads++;
        if (!sourceAvailable) return null;
        return { userMessage: '我长期喜欢棉质衣物', assistantMessage: '好的' };
      },
    } as never,
    {
      get: async () => ({
        content: '已有的衣物记忆',
        revision: 0,
        updatedAt: null,
      }),
      applyExtractedOperations: async (input: {
        taskAttempts: number;
        taskLockedAt: Date;
      }) => {
        assert.equal(input.taskAttempts, task.attempts);
        assert.equal(input.taskLockedAt, task.lockedAt);
        if (failApply) throw new ServiceUnavailableException();
        applied++;
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
    counts: () => ({ generated, applied, sourceReads }),
    modelInput: () => modelInput,
  };
}

test('记忆关闭或租约无效时不读取聊天也不调用模型', async () => {
  const f = fixture();
  f.disable();
  await f.service.process(f.task);
  assert.deepEqual(f.counts(), { generated: 0, applied: 0, sourceReads: 0 });
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
  assert.deepEqual(f.counts(), { generated: 1, applied: 1, sourceReads: 2 });
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
  assert.deepEqual(f.counts(), { generated: 1, applied: 0, sourceReads: 2 });
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
