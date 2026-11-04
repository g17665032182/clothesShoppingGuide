import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictException, ServiceUnavailableException } from '@nestjs/common';

import { memoryDocumentContentSchema } from '../context/memory-document.schema.js';
import { UserMemoryDocumentState } from '../entity/user-memory-document-state.entity.js';
import { UserMemoryDocumentTaskResult } from '../entity/user-memory-document-task-result.entity.js';
import { UserMemorySetting } from '../entity/user-memory-setting.entity.js';
import { UserMemoryTask } from '../entity/user-memory-task.entity.js';
import { UserMemoryDocumentService } from '../service/user-memory-document.service.js';

function createFixture() {
  const states = new Map<string, UserMemoryDocumentState>();
  const results: UserMemoryDocumentTaskResult[] = [];
  const objects = new Map<string, Buffer>();
  const scheduled = new Set<string>();
  let enabled = true;
  let reads = 0;
  let uploads = 0;
  let leaseValid = true;

  const stateRepository = {
    findOne: async ({ userId }: { userId: string }) =>
      states.get(userId) ?? null,
    create: (data: UserMemoryDocumentState) => {
      const state = Object.assign(new UserMemoryDocumentState(), data);
      states.set(state.userId, state);
      return state;
    },
    getEntityManager: () => manager,
  };
  const resultRepository = {
    findOne: async (where: { taskId: string; operationKey: string }) =>
      results.find(
        (result) =>
          result.taskId === where.taskId &&
          result.operationKey === where.operationKey,
      ) ?? null,
    create: (data: UserMemoryDocumentTaskResult) =>
      Object.assign(new UserMemoryDocumentTaskResult(), data),
  };
  type TestManager = {
    transactional: <T>(callback: (em: TestManager) => Promise<T>) => Promise<T>;
    getConnection: () => { execute: () => Promise<undefined> };
    getTransactionContext: () => undefined;
    getRepository: (entity: unknown) => unknown;
    persist: (entity: unknown) => void;
    flush: () => Promise<void>;
    fork: () => TestManager;
    findOne: (entity: unknown) => Promise<unknown>;
    nativeUpdate: () => Promise<number>;
  };
  const manager: TestManager = {
    transactional: async <T>(callback: (em: TestManager) => Promise<T>) =>
      callback(manager),
    fork: () => manager,
    findOne: async (entity: unknown) =>
      entity === UserMemoryTask && leaseValid ? {} : null,
    nativeUpdate: async () => 0,
    getConnection: () => ({ execute: async () => undefined }),
    getTransactionContext: () => undefined,
    getRepository: (entity: unknown) => {
      if (entity === UserMemoryDocumentState) return stateRepository;
      if (entity === UserMemoryDocumentTaskResult) return resultRepository;
      if (entity === UserMemorySetting)
        return { findOne: async () => ({ enabled }) };
      throw new Error('unknown entity');
    },
    persist: (entity: unknown) => {
      if (entity instanceof UserMemoryDocumentTaskResult) results.push(entity);
    },
    flush: async () => undefined,
  };
  const store = {
    putRevision: async (userId: string, revision: number, content: string) => {
      uploads += 1;
      const key = `${userId}/${revision}/${uploads}`;
      objects.set(key, Buffer.from(content));
      return key;
    },
    readObject: async (key: string) => {
      reads += 1;
      const object = objects.get(key);
      if (!object) throw new Error('missing');
      return object;
    },
  };
  const cleanup = {
    trackUploaded: async (_userId: string, key: string) => {
      scheduled.add(key);
    },
    schedule: async (_em: unknown, _userId: string, key: string) => {
      scheduled.add(key);
    },
    cancel: async (_em: unknown, key: string) => {
      scheduled.delete(key);
    },
  };
  return {
    service: new UserMemoryDocumentService(
      stateRepository as never,
      store as never,
      cleanup as never,
    ),
    states,
    objects,
    scheduled,
    results,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    getReads: () => reads,
    getUploads: () => uploads,
    invalidateLease: () => {
      leaseValid = false;
    },
  };
}

test('文档校验限制字节、敏感信息和不合法 Unicode', () => {
  assert.equal(
    memoryDocumentContentSchema.safeParse('a'.repeat(32768)).success,
    true,
  );
  assert.equal(
    memoryDocumentContentSchema.safeParse('a'.repeat(32769)).success,
    false,
  );
  assert.equal(memoryDocumentContentSchema.safeParse('\ud800').success, false);
  assert.equal(
    memoryDocumentContentSchema.safeParse('喜欢运动鞋 👟').success,
    true,
  );
  assert.equal(
    memoryDocumentContentSchema.safeParse('电话 13800138000').success,
    false,
  );
});

test('读取和写入隔离用户，冲突不访问存储，同内容不递增版本', async () => {
  const fixture = createFixture();
  const { service } = fixture;
  assert.equal((await service.get('a')).revision, 0);
  const saved = await service.update('a', {
    content: '喜欢运动鞋',
    expectedRevision: 0,
  });
  assert.equal(saved.revision, 1);
  assert.equal((await service.get('b')).content, '');
  const reads = fixture.getReads();
  await assert.rejects(
    service.update('a', { content: '新内容', expectedRevision: 0 }),
    ConflictException,
  );
  assert.equal(fixture.getReads(), reads);
  assert.equal(
    (await service.update('a', { content: saved.content, expectedRevision: 1 }))
      .revision,
    1,
  );
  assert.equal(fixture.getUploads(), 1);
});

test('丢失对象返回不可用，但清空仍推进代次并登记清理', async () => {
  const fixture = createFixture();
  await fixture.service.update('a', {
    content: '喜欢蓝色',
    expectedRevision: 0,
  });
  const state = fixture.states.get('a')!;
  const oldKey = state.objectKey!;
  fixture.objects.delete(oldKey);
  await assert.rejects(fixture.service.get('a'), ServiceUnavailableException);
  await fixture.service.clear('a');
  assert.equal(state.revision, 2);
  assert.equal(state.documentGeneration, 1);
  assert.ok(fixture.scheduled.has(oldKey));
  await fixture.service.clear('a');
  assert.equal(state.revision, 2);
  assert.equal(state.documentGeneration, 2);
  assert.equal((await fixture.service.get('a')).content, '');
});

test('提取操作去重、匹配唯一目标并隔离清空前的任务', async () => {
  const fixture = createFixture();
  const { service } = fixture;
  await service.update('a', { content: '手工内容', expectedRevision: 0 });
  const append = {
    operation: 'append' as const,
    section: 'other' as const,
    markdown: '喜欢简洁',
    explicit: true as const,
  };
  const input = {
    userId: 'a',
    taskId: 'task',
    documentGeneration: 0,
    taskAttempts: 1,
    taskLockedAt: new Date(),
    operations: [append, append],
  };
  await service.applyExtractedOperations(input);
  await service.applyExtractedOperations(input);
  assert.equal(fixture.results.length, 1);
  assert.equal((await service.get('a')).content.match(/喜欢简洁/g)?.length, 1);
  await service.applyExtractedOperations({ ...input, taskId: 'another-task' });
  assert.equal((await service.get('a')).content.match(/喜欢简洁/g)?.length, 1);
  await service.applyExtractedOperations({
    ...input,
    taskId: 'replace',
    operations: [
      {
        operation: 'replace',
        targetText: '手工内容',
        replacement: '保留的内容',
        explicit: true,
      },
    ],
  });
  assert.match((await service.get('a')).content, /保留的内容/);
  await service.clear('a');
  await service.applyExtractedOperations({ ...input, taskId: 'old-task' });
  assert.equal((await service.get('a')).content, '');
});

test('关闭记忆和超过文档上限时不会应用提取内容', async () => {
  const fixture = createFixture();
  const { service } = fixture;
  fixture.setEnabled(false);
  const operation = {
    operation: 'append' as const,
    section: 'other' as const,
    markdown: '喜爱衬衫',
    explicit: true as const,
  };
  await service.applyExtractedOperations({
    userId: 'a',
    taskId: 'disabled',
    documentGeneration: 0,
    taskAttempts: 1,
    taskLockedAt: new Date(),
    operations: [operation],
  });
  assert.equal((await service.get('a')).content, '');
  fixture.setEnabled(true);
  await service.update('a', {
    content: 'a'.repeat(32768),
    expectedRevision: 0,
  });
  await service.applyExtractedOperations({
    userId: 'a',
    taskId: 'too-large',
    documentGeneration: 0,
    taskAttempts: 1,
    taskLockedAt: new Date(),
    operations: [operation],
  });
  assert.equal((await service.get('a')).content.length, 32768);
});

test('过期租约不能上传对象或提交文档补丁', async () => {
  const fixture = createFixture();
  fixture.invalidateLease();
  await fixture.service.applyExtractedOperations({
    userId: 'a',
    taskId: 'stale',
    taskAttempts: 1,
    taskLockedAt: new Date(),
    documentGeneration: 0,
    operations: [
      {
        operation: 'append',
        section: 'clothing',
        markdown: '喜欢棉质外套',
        explicit: true,
      },
    ],
  });
  assert.equal(fixture.getUploads(), 0);
  assert.equal(fixture.results.length, 0);
});
