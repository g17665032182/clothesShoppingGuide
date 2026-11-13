import assert from 'node:assert/strict';
import test from 'node:test';
import { IsolationLevel } from '@mikro-orm/core';

import {
  tryOnTaskMetadataPageSchema,
  tryOnTaskMetadataQuerySchema,
} from '../dto/try-on-task-metadata.dto.js';
import { TryOnResult } from '../entity/try-on-result.entity.js';
import { TryOnTask, TryOnTaskStatus } from '../entity/try-on-task.entity.js';
import { TryOnTaskReaderService } from '../service/try-on-task-reader.service.js';

const owner = '00000000-0000-4000-8000-000000000001';
const stranger = '00000000-0000-4000-8000-000000000002';
const createdAt = new Date('2026-11-13T00:00:00.000Z');

function makeTask(
  sequence: number,
  overrides: Partial<TryOnTask> = {},
): TryOnTask {
  return Object.assign(new TryOnTask(), {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    userId: owner,
    status: TryOnTaskStatus.SUCCEEDED,
    productExternalId: 'coat-1',
    productName: '试穿外套',
    productCategory: 'outerwear',
    color: '黑色',
    createdAt,
    completedAt: new Date('2026-11-13T00:01:00.000Z'),
    sourcePhotoId: 'private-photo',
    garmentImageUrl: 'https://private.example.com/garment.webp',
    garmentImageObjectKey: 'private/garment.webp',
    providerRequestId: 'private-provider-request',
    failureCode: 'PRIVATE_FAILURE',
    deletedAt: null,
    ...overrides,
  });
}

function makeResult(
  task: TryOnTask,
  overrides: Partial<TryOnResult> = {},
): TryOnResult {
  return Object.assign(new TryOnResult(), {
    taskId: task.id,
    userId: task.userId,
    objectKey: 'private/result.webp',
    deletedAt: null,
    ...overrides,
  });
}

function createFixture(tasks: TryOnTask[], results: TryOnResult[] = []) {
  const calls: {
    forks: unknown[];
    transactions: unknown[];
    tasks: unknown[];
    results: unknown[];
  } = { forks: [], transactions: [], tasks: [], results: [] };
  const transaction = {
    findAndCount: async (
      entity: unknown,
      where: {
        userId: string;
        deletedAt: null;
        status: { $in: TryOnTaskStatus[] };
      },
      options: {
        fields: string[];
        orderBy: { createdAt: string; id: string };
        offset: number;
        limit: number;
      },
    ) => {
      calls.tasks.push({ entity, where, options });
      const matched = tasks
        .filter(
          (task) =>
            task.userId === where.userId &&
            task.deletedAt === where.deletedAt &&
            where.status.$in.includes(task.status),
        )
        .sort(
          (a, b) =>
            b.createdAt.valueOf() - a.createdAt.valueOf() ||
            b.id.localeCompare(a.id),
        );
      return [
        matched.slice(options.offset, options.offset + options.limit),
        matched.length,
      ];
    },
    find: async (
      entity: unknown,
      where: {
        userId: string;
        deletedAt: null;
        taskId: { $in: string[] };
      },
      options: unknown,
    ) => {
      calls.results.push({ entity, where, options });
      return results.filter(
        (result) =>
          result.userId === where.userId &&
          result.deletedAt === where.deletedAt &&
          where.taskId.$in.includes(result.taskId),
      );
    },
  };
  const fork = {
    transactional: async (
      callback: (em: typeof transaction) => unknown,
      options: unknown,
    ) => {
      calls.transactions.push(options);
      return callback(transaction);
    },
  };
  const em = {
    fork: (options: unknown) => {
      calls.forks.push(options);
      return fork;
    },
  };
  const service = new TryOnTaskReaderService({
    getEntityManager: () => em,
  } as never);
  return { service, calls, transaction };
}

test('元数据查询只接受四状态与实际有界整数，拒绝身份和动作字段', () => {
  for (const status of ['queued', 'processing', 'succeeded', 'failed']) {
    assert.deepEqual(tryOnTaskMetadataQuerySchema.parse({ page: 1, status }), {
      page: 1,
      status,
    });
  }
  assert.deepEqual(tryOnTaskMetadataQuerySchema.parse({ page: 10 }), {
    page: 10,
  });
  for (const input of [
    {},
    { page: '1' },
    { page: 0 },
    { page: 11 },
    { page: 1.5 },
    { page: 1, status: 'deleted' },
    { page: 1, userId: owner },
    { page: 1, taskId: 'task' },
    { page: 1, pageSize: 10 },
    { page: 1, unread: true },
  ]) {
    assert.equal(tryOnTaskMetadataQuerySchema.safeParse(input).success, false);
  }
});

test('每次查询使用独立只读一致性事务，任务和结果均为最小字段查询', async () => {
  const task = makeTask(3);
  const fixture = createFixture([task], [makeResult(task)]);
  const page = await fixture.service.listMetadataForUser(owner, { page: 1 });

  assert.deepEqual(fixture.calls.forks, [
    { clear: true, useContext: false, keepTransactionContext: false },
  ]);
  assert.deepEqual(fixture.calls.transactions, [
    { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true },
  ]);
  assert.deepEqual(fixture.calls.tasks, [
    {
      entity: TryOnTask,
      where: {
        userId: owner,
        deletedAt: null,
        status: {
          $in: [
            TryOnTaskStatus.QUEUED,
            TryOnTaskStatus.PROCESSING,
            TryOnTaskStatus.SUCCEEDED,
            TryOnTaskStatus.FAILED,
          ],
        },
      },
      options: {
        fields: [
          'id',
          'status',
          'productExternalId',
          'productName',
          'productCategory',
          'color',
          'createdAt',
          'completedAt',
        ],
        orderBy: { createdAt: 'DESC', id: 'DESC' },
        limit: 5,
        offset: 0,
      },
    },
  ]);
  assert.deepEqual(fixture.calls.results, [
    {
      entity: TryOnResult,
      where: { userId: owner, taskId: { $in: [task.id] }, deletedAt: null },
      options: { fields: ['taskId'] },
    },
  ]);
  assert.deepEqual(page, {
    items: [
      {
        taskId: task.id,
        status: 'succeeded',
        product: {
          externalId: 'coat-1',
          name: '试穿外套',
          category: 'outerwear',
          color: '黑色',
        },
        createdAt: createdAt.toISOString(),
        completedAt: '2026-11-13T00:01:00.000Z',
        resultAvailable: true,
      },
    ],
    page: 1,
    pageSize: 5,
    total: 1,
  });
  assert.doesNotMatch(
    JSON.stringify(page),
    /private|provider|photo|objectKey|garment|failureCode/i,
  );
});

test('本人任务在过滤后稳定分页并保留真实总数，排除他人和两种删除记录', async () => {
  const tasks = Array.from({ length: 7 }, (_, index) => makeTask(index + 10));
  const fixture = createFixture([
    ...tasks,
    makeTask(90, { userId: stranger }),
    makeTask(91, { status: TryOnTaskStatus.DELETED }),
    makeTask(92, { deletedAt: new Date() }),
  ]);
  const first = await fixture.service.listMetadataForUser(owner, { page: 1 });
  const second = await fixture.service.listMetadataForUser(owner, { page: 2 });

  assert.deepEqual(
    first.items.map((item) => item.taskId),
    [...tasks]
      .reverse()
      .slice(0, 5)
      .map((task) => task.id),
  );
  assert.deepEqual(
    second.items.map((item) => item.taskId),
    [...tasks]
      .reverse()
      .slice(5)
      .map((task) => task.id),
  );
  assert.equal(first.total, 7);
  assert.equal(second.total, 7);
  assert.equal(fixture.calls.results.length, 2);
  assert.equal(fixture.calls.forks.length, 2);
});

test('四种状态独立筛选，未完成时间保持 null', async () => {
  const statuses = [
    TryOnTaskStatus.QUEUED,
    TryOnTaskStatus.PROCESSING,
    TryOnTaskStatus.SUCCEEDED,
    TryOnTaskStatus.FAILED,
  ] as const;
  const fixture = createFixture(
    statuses.map((status, index) =>
      makeTask(index + 10, {
        status,
        completedAt:
          status === TryOnTaskStatus.QUEUED ||
          status === TryOnTaskStatus.PROCESSING
            ? null
            : createdAt,
      }),
    ),
  );
  for (const status of statuses) {
    const page = await fixture.service.listMetadataForUser(owner, {
      page: 1,
      status,
    });
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.status, status);
    assert.equal(
      page.items[0]?.completedAt,
      status === TryOnTaskStatus.QUEUED || status === TryOnTaskStatus.PROCESSING
        ? null
        : createdAt.toISOString(),
    );
  }
});

test('结果可用只取本人未删除且成功任务的记录，不以成功状态推断', async () => {
  const tasks = [
    makeTask(10),
    makeTask(11),
    makeTask(12),
    makeTask(13),
    makeTask(14, { status: TryOnTaskStatus.PROCESSING, completedAt: null }),
  ];
  const fixture = createFixture(tasks, [
    makeResult(tasks[0]!),
    makeResult(tasks[1]!, { userId: stranger }),
    makeResult(tasks[2]!, { deletedAt: new Date() }),
    makeResult(tasks[4]!),
    makeResult(makeTask(99)),
  ]);
  const page = await fixture.service.listMetadataForUser(owner, { page: 1 });
  assert.deepEqual(
    page.items.map((item) => [item.taskId, item.resultAvailable]),
    [...tasks].reverse().map((task) => [task.id, task.id === tasks[0]!.id]),
  );
  assert.equal(fixture.calls.results.length, 1);
});

test('空列表和越界空页成功返回并跳过结果查询', async () => {
  const empty = createFixture([]);
  assert.deepEqual(
    await empty.service.listMetadataForUser(owner, { page: 1 }),
    { items: [], page: 1, pageSize: 5, total: 0 },
  );
  assert.equal(empty.calls.results.length, 0);

  const beyond = createFixture([makeTask(10)]);
  assert.deepEqual(
    await beyond.service.listMetadataForUser(owner, { page: 10 }),
    { items: [], page: 10, pageSize: 5, total: 1 },
  );
  assert.equal(beyond.calls.results.length, 0);
});

test('非法查询在数据库读取前拒绝；查询故障与损坏投影不能伪装为空页', async () => {
  const invalidInput = createFixture([]);
  await assert.rejects(
    invalidInput.service.listMetadataForUser(owner, {
      page: 1,
      userId: stranger,
    } as never),
  );
  assert.equal(invalidInput.calls.forks.length, 0);

  const unavailable = createFixture([]);
  unavailable.transaction.findAndCount = async () => {
    throw new Error('数据库不可用');
  };
  await assert.rejects(
    unavailable.service.listMetadataForUser(owner, { page: 1 }),
    /数据库不可用/,
  );
  for (const overrides of [
    { productName: '损坏\u0000名称' },
    { productCategory: 'shoes' },
    { color: ' ' },
    { createdAt: new Date('invalid') },
  ]) {
    const broken = createFixture([makeTask(10, overrides)]);
    await assert.rejects(
      broken.service.listMetadataForUser(owner, { page: 1 }),
    );
  }
});

test('输出 schema 拒绝任务、商品及页面未知字段', async () => {
  const fixture = createFixture([makeTask(10)]);
  const page = await fixture.service.listMetadataForUser(owner, { page: 1 });
  assert.equal(
    tryOnTaskMetadataPageSchema.safeParse({ ...page, userId: owner }).success,
    false,
  );
  const item = page.items[0]!;
  for (const unsafe of [
    { ...item, sourcePhotoId: 'private-photo' },
    { ...item, product: { ...item.product, imageUrl: 'https://private' } },
  ]) {
    assert.equal(
      tryOnTaskMetadataPageSchema.safeParse({ ...page, items: [unsafe] })
        .success,
      false,
    );
  }
});
