import assert from 'node:assert/strict';
import test from 'node:test';
import { IsolationLevel } from '@mikro-orm/core';

import {
  getPreferenceValueType,
  type PreferenceCategory,
} from '../context/preference-value.schema.js';
import { UserPreferenceSetting } from '../entity/user-preference-setting.entity.js';
import {
  UserPreference,
  UserPreferenceStatus,
} from '../entity/user-preference.entity.js';
import { UserPreferenceReaderService } from '../service/user-preference-reader.service.js';

const owner = '00000000-0000-4000-8000-000000000001';
const stranger = '00000000-0000-4000-8000-000000000002';
const updatedAt = new Date('2026-11-16T00:00:00.000Z');

function makePreference(
  sequence: number,
  overrides: Partial<UserPreference> = {},
): UserPreference {
  return Object.assign(new UserPreference(), {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    userId: owner,
    category: 'style',
    valueType: 'multi',
    value: { items: [`风格${sequence}`] },
    isPrimary: false,
    status: UserPreferenceStatus.ACTIVE,
    deletedAt: null,
    sourceConversationId: 'private-conversation',
    valueFingerprint: 'private-fingerprint',
    updatedAt,
    ...overrides,
  });
}

function createFixture(
  rows: UserPreference[],
  setting: { enabled: boolean } | null = null,
) {
  const calls: {
    forks: unknown[];
    transactions: unknown[];
    settings: unknown[];
    queries: unknown[];
    writes: string[];
  } = { forks: [], transactions: [], settings: [], queries: [], writes: [] };
  const transaction = {
    findOne: async (entity: unknown, where: unknown, options: unknown) => {
      calls.settings.push({ entity, where, options });
      return setting;
    },
    findAndCount: async (
      entity: unknown,
      where: {
        userId: string;
        status: UserPreferenceStatus;
        deletedAt: null;
        category?: PreferenceCategory;
      },
      options: {
        fields: string[];
        orderBy: unknown;
        limit: number;
        offset: number;
      },
    ): Promise<[UserPreference[], number]> => {
      calls.queries.push({ entity, where, options });
      const matches = rows
        .filter(
          (record) =>
            record.userId === where.userId &&
            record.status === where.status &&
            record.deletedAt === where.deletedAt &&
            (!where.category || record.category === where.category),
        )
        .sort(
          (left, right) =>
            Number(right.isPrimary) - Number(left.isPrimary) ||
            right.updatedAt.getTime() - left.updatedAt.getTime() ||
            left.id.localeCompare(right.id),
        );
      return [
        matches.slice(options.offset, options.offset + options.limit),
        matches.length,
      ];
    },
    persist: () => calls.writes.push('persist'),
    flush: async () => calls.writes.push('flush'),
    nativeUpdate: async () => calls.writes.push('nativeUpdate'),
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
  const manager = {
    fork: (options: unknown) => {
      calls.forks.push(options);
      return fork;
    },
  };
  const service = new UserPreferenceReaderService({
    getEntityManager: () => manager,
  } as never);
  return { service, calls, transaction, fork, manager };
}

test('偏好聊天查询使用独立只读一致性快照，直接读取设置和最小字段', async () => {
  const fixture = createFixture([makePreference(1)], { enabled: true });
  const result = await fixture.service.listForChat(owner, { page: 1 });
  assert.deepEqual(result, {
    ok: true,
    items: [
      {
        category: 'style',
        valueType: 'multi',
        value: { items: ['风格1'] },
        isPrimary: false,
        updatedAt: updatedAt.toISOString(),
      },
    ],
    page: 1,
    pageSize: 5,
    total: 1,
    hasNext: false,
  });
  assert.deepEqual(fixture.calls.forks, [
    { clear: true, useContext: false, keepTransactionContext: false },
  ]);
  assert.deepEqual(fixture.calls.transactions, [
    { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true },
  ]);
  assert.deepEqual(fixture.calls.settings, [
    {
      entity: UserPreferenceSetting,
      where: { userId: owner },
      options: { fields: ['enabled'] },
    },
  ]);
  assert.deepEqual(fixture.calls.queries, [
    {
      entity: UserPreference,
      where: {
        userId: owner,
        status: UserPreferenceStatus.ACTIVE,
        deletedAt: null,
      },
      options: {
        fields: [
          'id',
          'category',
          'valueType',
          'value',
          'isPrimary',
          'updatedAt',
        ],
        orderBy: { isPrimary: 'DESC', updatedAt: 'DESC', id: 'ASC' },
        limit: 5,
        offset: 0,
      },
    },
  ]);
  assert.deepEqual(fixture.calls.writes, []);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private|source|fingerprint|userId|conversationId|"id"/iu,
  );
});

test('关闭偏好时不查询记录或计数，缺设置按默认开启且不会初始化', async () => {
  const disabled = createFixture([makePreference(1)], { enabled: false });
  assert.deepEqual(await disabled.service.listForChat(owner, { page: 1 }), {
    ok: false,
    code: 'preferences_disabled',
  });
  assert.equal(disabled.calls.queries.length, 0);
  assert.deepEqual(disabled.calls.writes, []);

  const missing = createFixture([makePreference(1)]);
  const result = await missing.service.listForChat(owner, { page: 1 });
  assert.equal(result.ok, true);
  assert.equal(missing.calls.queries.length, 1);
  assert.deepEqual(missing.calls.writes, []);
});

test('本人和双删除条件过滤完整集合后稳定分页，不输出来源或内部引用', async () => {
  const records = Array.from({ length: 7 }, (_, index) =>
    makePreference(index + 1),
  );
  const fixture = createFixture([
    ...records,
    makePreference(80, { userId: stranger }),
    makePreference(81, { status: UserPreferenceStatus.DELETED }),
    makePreference(82, { deletedAt: new Date() }),
  ]);
  const first = await fixture.service.listForChat(owner, { page: 1 });
  const second = await fixture.service.listForChat(owner, { page: 2 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.total, 7);
  assert.equal(second.total, 7);
  assert.equal(first.hasNext, true);
  assert.equal(second.hasNext, false);
  assert.deepEqual(
    [...first.items, ...second.items].map((record) => record.value),
    records.map((record) => record.value),
  );
});

test('类别先过滤，主偏好优先、更新时间倒序及同时间ID稳定排序', async () => {
  const primary = makePreference(8, { isPrimary: true });
  const newer = makePreference(9, {
    updatedAt: new Date('2026-11-16T01:00:00.000Z'),
  });
  const firstTie = makePreference(1);
  const secondTie = makePreference(2);
  const fixture = createFixture([
    secondTie,
    makePreference(3, {
      category: 'fit',
      valueType: 'single',
      value: { preference: 'loose' },
    }),
    newer,
    firstTie,
    primary,
  ]);
  const result = await fixture.service.listForChat(owner, {
    page: 1,
    category: 'style',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.total, 4);
  assert.deepEqual(
    result.items.map((record) => record.value),
    [primary, newer, firstTie, secondTie].map((record) => record.value),
  );
});

test('九类安全值按原类别与主偏好真实读取，不合并或覆盖', async () => {
  const values = [
    ['size', { garment: '上衣', label: 'M' }],
    ['shoe_size', { value: 38, system: 'EU' }],
    ['fit', { preference: 'loose' }],
    ['style', { items: ['休闲'] }],
    ['color', { mode: 'prefer', items: ['blue'] }],
    ['occasion', { items: ['通勤'] }],
    ['budget', { currency: 'USD', max: 100 }],
    ['avoidance', { terms: ['紧身'] }],
    ['purchase_preference', { items: ['quality'] }],
  ] as const;
  for (const [category, value] of values) {
    const record = makePreference(1, {
      category,
      valueType: getPreferenceValueType(category),
      value: structuredClone(value) as UserPreference['value'],
      isPrimary: true,
    });
    const fixture = createFixture([record]);
    const result = await fixture.service.listForChat(owner, {
      category,
      page: 1,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.items[0]?.category, category);
    assert.equal(result.items[0]?.isPrimary, true);
    assert.deepEqual(result.items[0]?.value, value);
    assert.deepEqual(record.value, value);
  }
});

test('空集合及超出列表的页保留真实total，第十页仍如实报告有后续', async () => {
  const empty = createFixture([]);
  assert.deepEqual(await empty.service.listForChat(owner, { page: 1 }), {
    ok: true,
    items: [],
    page: 1,
    pageSize: 5,
    total: 0,
    hasNext: false,
  });
  const beyond = createFixture([makePreference(1)]);
  assert.deepEqual(await beyond.service.listForChat(owner, { page: 10 }), {
    ok: true,
    items: [],
    page: 10,
    pageSize: 5,
    total: 1,
    hasNext: false,
  });
  const long = createFixture(
    Array.from({ length: 51 }, (_, index) => makePreference(index + 1)),
  );
  const last = await long.service.listForChat(owner, { page: 10 });
  assert.equal(last.ok, true);
  if (!last.ok) return;
  assert.equal(last.items.length, 5);
  assert.equal(last.total, 51);
  assert.equal(last.hasNext, true);
});

test('非法参数在创建fork或访问设置前拒绝，不当作依赖失败', async () => {
  const fixture = createFixture([]);
  for (const input of [
    { page: 0 },
    { page: 1, userId: stranger },
    { page: '1' },
    { page: 1, category: 'unknown' },
  ]) {
    await assert.rejects(fixture.service.listForChat(owner, input as never));
  }
  assert.deepEqual(fixture.calls.forks, []);
  assert.deepEqual(fixture.calls.settings, []);
});

test('坏值、类型错配或敏感记录使整次查询失败，不漏项或回显原文', async () => {
  const broken: Partial<UserPreference>[] = [
    { valueType: 'single' },
    { value: { items: ['联系 13800138000'] } },
    { value: { items: [] } },
    { value: { items: ['休闲'], source: 'private' } as never },
    { category: 'unknown' as never },
    { updatedAt: new Date('invalid') },
    { isPrimary: 'true' as never },
  ];
  for (const overrides of broken) {
    const fixture = createFixture([
      makePreference(1),
      makePreference(2, overrides),
    ]);
    assert.deepEqual(await fixture.service.listForChat(owner, { page: 1 }), {
      ok: false,
      code: 'unavailable',
    });
    assert.deepEqual(fixture.calls.writes, []);
  }
});

test('设置或列表故障固定unavailable，下一次查询可恢复', async () => {
  for (const method of ['findOne', 'findAndCount'] as const) {
    const fixture = createFixture([]);
    const original = fixture.transaction[method];
    Object.assign(fixture.transaction, {
      [method]: async () => {
        throw new Error('private database connection string');
      },
    });
    assert.deepEqual(await fixture.service.listForChat(owner, { page: 1 }), {
      ok: false,
      code: 'unavailable',
    });
    Object.assign(fixture.transaction, { [method]: original });
    const recovered = await fixture.service.listForChat(owner, { page: 1 });
    assert.equal(recovered.ok, true);
  }
});

test('结果条数与总数不一致时失败，不用截断后的结果冒充完整页', async () => {
  const fixture = createFixture([]);
  fixture.transaction.findAndCount = async () => [[makePreference(1)], 10];
  assert.deepEqual(await fixture.service.listForChat(owner, { page: 1 }), {
    ok: false,
    code: 'unavailable',
  });
});
