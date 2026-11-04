import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import { UserPreferencesService } from '../service/user-preferences.service.js';

type PreferenceRecord = {
  id: string;
  userId: string;
  category: string;
  value: unknown;
  valueType: string;
  valueFingerprint: string;
  isPrimary: boolean;
  status: string;
  sourceConversationId: string | null;
  sourceStatus: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function createService(initial: PreferenceRecord[] = []) {
  const records = [...initial];
  let sequence = 0;
  const repository = {
    async findOne(where: Record<string, unknown>) {
      return (
        records.find((record) =>
          Object.entries(where).every(([key, value]) => {
            if (value && typeof value === 'object') return true;
            return record[key as keyof PreferenceRecord] === value;
          }),
        ) ?? null
      );
    },
    async find(where: Record<string, unknown>) {
      return records.filter((record) =>
        Object.entries(where).every(
          ([key, value]) => record[key as keyof PreferenceRecord] === value,
        ),
      );
    },
    async count(where: Record<string, unknown>) {
      return (await this.find(where)).length;
    },
    create(input: Omit<PreferenceRecord, 'id'>) {
      const record = { ...input, id: `preference-${++sequence}` };
      records.push(record);
      return record;
    },
    async nativeUpdate(
      where: Record<string, unknown>,
      update: Partial<PreferenceRecord>,
    ) {
      for (const record of records) {
        const matches = Object.entries(where).every(([key, value]) => {
          const current = record[key as keyof PreferenceRecord];
          if (typeof value === 'object' && value !== null && '$ne' in value) {
            return current !== value.$ne;
          }
          return current === value;
        });
        if (matches) Object.assign(record, update);
      }
    },
    async flush() {},
    getEntityManager() {
      return manager;
    },
  };
  type TestManager = {
    flush: () => Promise<void>;
    transactional: <T>(callback: (em: TestManager) => Promise<T>) => Promise<T>;
    getRepository: () => typeof repository;
    getConnection: () => { execute: () => Promise<void> };
    getTransactionContext: () => undefined;
    persist: () => void;
    findOne: (
      entity: unknown,
      where: Record<string, unknown>,
    ) => Promise<PreferenceRecord | null>;
  };
  const manager: TestManager = {
    async flush() {},
    async transactional<T>(callback: (em: TestManager) => Promise<T>) {
      return callback(manager);
    },
    getRepository() {
      return repository;
    },
    getConnection: () => ({ execute: async () => {} }),
    getTransactionContext: () => undefined,
    persist() {},
    findOne: (_entity, where) => repository.findOne(where),
  };
  const settings = {
    getSettings: async () => ({
      enabled: false,
      updatedAt: new Date().toISOString(),
    }),
  };
  const service = new UserPreferencesService(
    repository as never,
    settings as never,
  );

  return { service, records };
}

const blueColor = {
  category: 'color' as const,
  value: { mode: 'prefer' as const, items: ['深蓝'] },
  isPrimary: false,
};

test('手动创建会规范化类别值并对同用户重复值幂等', async () => {
  const { service, records } = createService();

  const first = await service.create('user-1', blueColor);
  const duplicate = await service.create('user-1', blueColor);

  assert.equal(first.id, duplicate.id);
  assert.equal(records.length, 1);
  assert.equal(first.category, 'color');
});

test('手动创建会拒绝自由文本中的敏感信息', async () => {
  const { service, records } = createService();

  await assert.rejects(
    service.create('user-1', {
      category: 'fit',
      value: { preference: 'loose', notes: '联系 13800138000' },
      isPrimary: false,
    }),
    BadRequestException,
  );
  assert.equal(records.length, 0);
});

test('自定义场景可创建及更新并隔离用户，敏感文本仍被拒绝', async () => {
  const { service } = createService();
  const input = {
    category: 'occasion' as const,
    value: { items: ['home', '参加婚礼'] },
    isPrimary: false,
  };
  const first = await service.create('user-1', input);
  const duplicate = await service.create('user-1', input);
  assert.equal(duplicate.id, first.id);
  const other = await service.create('user-2', input);
  assert.notEqual(other.id, first.id);
  const updated = await service.update('user-1', first.id, {
    value: { items: ['出差见客户', 'home'] },
  });
  assert.deepEqual(updated.value, { items: ['出差见客户', 'home'] });
  await assert.rejects(
    service.update('user-1', first.id, { value: { items: ['a'.repeat(33)] } }),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
  await assert.rejects(
    service.update('user-1', first.id, { value: null }),
    BadRequestException,
  );
  await assert.rejects(
    service.update('user-2', first.id, { value: { items: ['通勤'] } }),
    NotFoundException,
  );
  await assert.rejects(
    service.create('user-1', {
      ...input,
      value: { items: ['联系 13800138000'] },
    }),
    BadRequestException,
  );
});

test('更新和删除只能访问当前用户拥有的活动偏好', async () => {
  const now = new Date('2026-11-03T00:00:00.000Z');
  const { service, records } = createService([
    {
      id: 'other-user-preference',
      userId: 'user-2',
      category: 'color',
      value: { mode: 'prefer', items: ['深蓝'] },
      valueType: 'multi',
      valueFingerprint: 'other',
      isPrimary: false,
      status: 'active',
      sourceConversationId: null,
      sourceStatus: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await assert.rejects(
    service.update('user-1', 'other-user-preference', { isPrimary: true }),
    NotFoundException,
  );
  await assert.rejects(
    service.delete('user-1', 'other-user-preference'),
    NotFoundException,
  );
  assert.equal(records[0]?.status, 'active');
});

test('关闭自动偏好后仍可手动管理，分页仅携带偏好设置', async () => {
  const { service } = createService();
  const created = await service.create('user-1', blueColor);
  const listed = await service.list('user-1', { page: 1, pageSize: 20 });
  assert.equal(listed.settings.enabled, false);
  assert.equal(listed.total, 1);
  await service.update('user-1', created.id, {
    value: { mode: 'prefer', items: ['黑色'] },
  });
  await service.delete('user-1', created.id);
  assert.equal(
    (await service.list('user-1', { page: 1, pageSize: 20 })).total,
    0,
  );
});

test('同类重复更新返回400，主偏好切换只调整同用户同类别', async () => {
  const { service } = createService();
  const first = await service.create('user-1', {
    category: 'size',
    value: { garment: '上衣', label: 'L' },
    isPrimary: true,
  });
  const second = await service.create('user-1', {
    category: 'size',
    value: { garment: '上衣', label: 'XL' },
    isPrimary: true,
  });
  const listed = await service.list('user-1', { page: 1, pageSize: 20 });
  assert.equal(
    listed.items.find((item) => item.id === first.id)?.isPrimary,
    false,
  );
  assert.equal(
    listed.items.find((item) => item.id === second.id)?.isPrimary,
    true,
  );
  await assert.rejects(
    service.update('user-1', second.id, { value: first.value }),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
});
