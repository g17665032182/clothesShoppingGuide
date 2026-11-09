import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TryOnPhoto,
  TryOnPhotoKind,
  TryOnPhotoStatus,
} from '../entity/try-on-photo.entity.js';
import { TryOnTask, TryOnTaskStatus } from '../entity/try-on-task.entity.js';
import { TryOnTaskService } from '../service/try-on-task.service.js';
import { TryOnQuotaService } from '../service/try-on-quota.service.js';

function createFailureFixture(photoKind: TryOnPhotoKind) {
  const photo = {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    kind: photoKind,
    status: TryOnPhotoStatus.ACTIVE,
    objectKey: 'try-on/user/photos/photo.webp',
    taskId: '00000000-0000-4000-8000-000000000003',
    updatedAt: new Date(0),
    deletedAt: null,
  };
  const task = {
    id: '00000000-0000-4000-8000-000000000003',
    userId: photo.userId,
    status: TryOnTaskStatus.PROCESSING,
    sourcePhotoId: photo.id,
    updatedAt: new Date(0),
    completedAt: null,
    failureCode: null,
    lockedAt: new Date(),
  };
  const cleanups: unknown[] = [];
  const transaction = {
    findOne: async (entity: unknown) => {
      if (entity === TryOnTask) return task;
      if (entity === TryOnPhoto) return photo;
      return null;
    },
    create: (_entity: unknown, input: unknown) => {
      cleanups.push(input);
      return input;
    },
    flush: async () => undefined,
  };
  const entityManager = {
    fork: () => entityManager,
    transactional: async (callback: (em: typeof transaction) => unknown) =>
      callback(transaction),
  };
  const repository = { getEntityManager: () => entityManager };
  const service = new TryOnTaskService(
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, photo, task, cleanups };
}

test('最终失败后临时照片进入墓碑清理队列并从任务解绑', async () => {
  const fixture = createFailureFixture(TryOnPhotoKind.TEMPORARY);
  await fixture.service.markFailed(fixture.task as never, 'PROVIDER_REJECTED');

  assert.equal(fixture.task.status, TryOnTaskStatus.FAILED);
  assert.equal(fixture.task.sourcePhotoId, null);
  assert.equal(fixture.photo.status, TryOnPhotoStatus.DELETED);
  assert.equal(fixture.photo.taskId, null);
  assert.equal(fixture.cleanups.length, 1);
});

test('最终失败后保存照片保持有效且解除任务占用', async () => {
  const fixture = createFailureFixture(TryOnPhotoKind.SAVED);
  await fixture.service.markFailed(fixture.task as never, 'PROVIDER_REJECTED');

  assert.equal(fixture.task.status, TryOnTaskStatus.FAILED);
  assert.equal(fixture.photo.status, TryOnPhotoStatus.ACTIVE);
  assert.equal(fixture.photo.taskId, null);
  assert.equal(fixture.cleanups.length, 0);
});

test('每日额度日期以 Asia/Shanghai 自然日计算', () => {
  const service = new TryOnQuotaService({} as never);
  assert.equal(
    service.quotaDate(new Date('2026-11-08T15:59:59.999Z')),
    '2026-11-08',
  );
  assert.equal(
    service.quotaDate(new Date('2026-11-08T16:00:00.000Z')),
    '2026-11-09',
  );
});
