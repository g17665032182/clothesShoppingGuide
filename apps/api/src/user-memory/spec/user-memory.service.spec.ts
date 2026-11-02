import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import { UserMemoryService } from '../service/user-memory.service.js';

type MemoryRecord = {
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

function createService(initial: MemoryRecord[] = []) {
  const records = [...initial];
  let sequence = 0;
  const repository = {
    async findOne(where: Record<string, unknown>) {
      return (
        records.find((record) =>
          Object.entries(where).every(([key, value]) => {
            if (value && typeof value === 'object') return true;
            return record[key as keyof MemoryRecord] === value;
          }),
        ) ?? null
      );
    },
    async find(where: Record<string, unknown>) {
      return records.filter((record) =>
        Object.entries(where).every(
          ([key, value]) => record[key as keyof MemoryRecord] === value,
        ),
      );
    },
    async count(where: Record<string, unknown>) {
      return (await this.find(where)).length;
    },
    create(input: Omit<MemoryRecord, 'id'>) {
      const record = { ...input, id: `memory-${++sequence}` };
      records.push(record);
      return record;
    },
    async nativeUpdate(
      where: Record<string, unknown>,
      update: Partial<MemoryRecord>,
    ) {
      for (const record of records) {
        const matches = Object.entries(where).every(
          ([key, value]) => record[key as keyof MemoryRecord] === value,
        );
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
  };
  const manager: TestManager = {
    async flush() {},
    async transactional<T>(callback: (em: TestManager) => Promise<T>) {
      return callback(manager);
    },
    getRepository() {
      return repository;
    },
  };
  const settingsRepository = {
    findOne: async () => null,
    create: (value: unknown) => value,
    getEntityManager: () => manager,
  };
  const service = new UserMemoryService(
    repository as never,
    settingsRepository as never,
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

test('更新和删除只能访问当前用户拥有的活动记忆', async () => {
  const now = new Date('2026-11-03T00:00:00.000Z');
  const { service, records } = createService([
    {
      id: 'other-user-memory',
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
    service.update('user-1', 'other-user-memory', { isPrimary: true }),
    NotFoundException,
  );
  await assert.rejects(
    service.delete('user-1', 'other-user-memory'),
    NotFoundException,
  );
  assert.equal(records[0]?.status, 'active');
});
