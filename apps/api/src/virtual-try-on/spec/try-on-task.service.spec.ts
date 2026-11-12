import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { TryOnProductProjection } from '../../product-catalog/index.js';
import {
  TryOnPhoto,
  TryOnPhotoKind,
  TryOnPhotoStatus,
} from '../entity/try-on-photo.entity.js';
import { TryOnTask, TryOnTaskStatus } from '../entity/try-on-task.entity.js';
import { TryOnResult } from '../entity/try-on-result.entity.js';
import { TryOnTaskService } from '../service/try-on-task.service.js';
import { TryOnQuotaService } from '../service/try-on-quota.service.js';

function createAdmissionFixture() {
  const photo: TryOnPhoto = Object.assign(new TryOnPhoto(), {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    kind: TryOnPhotoKind.SAVED,
    status: TryOnPhotoStatus.ACTIVE,
    taskId: null,
    expiresAt: null,
  });
  let product: TryOnProductProjection | null = {
    productExternalId: 'coat-1',
    productName: '试穿大衣',
    category: 'outerwear',
    tryOnEnabled: true,
    tryOnEligible: true,
    tryOnImageObjectKey: null,
    mainImageUrl: 'https://images.example.com/main.webp',
    colors: [
      { color: '黑色', imageUrl: 'https://images.example.com/black.webp' },
    ],
  };
  const tasks: TryOnTask[] = [];
  const results: TryOnResult[] = [];
  const counts = {
    bindings: 0,
    photoReads: 0,
    quotaWrites: 0,
    flushes: 0,
    catalogReads: 0,
    objectStoreCalls: 0,
  };
  const transaction = {
    getConnection: () => ({ execute: async () => [] }),
    getTransactionContext: () => undefined,
    findOne: async (entity: unknown) => {
      if (entity === TryOnTask) return tasks[0] ?? null;
      if (entity === TryOnPhoto) {
        counts.photoReads += 1;
        return photo;
      }
      return null;
    },
    create: (entity: unknown, input: unknown) => {
      if (entity === TryOnTask) {
        const task = Object.assign(new TryOnTask(), input);
        tasks.push(task);
        return task;
      }
      if (entity === TryOnResult) {
        const result = Object.assign(new TryOnResult(), input);
        results.push(result);
        return result;
      }
      throw new Error('意外写入其他资源');
    },
    flush: async () => {
      counts.flushes += 1;
    },
  };
  const entityManager = {
    fork: () => entityManager,
    transactional: async (callback: (em: typeof transaction) => unknown) =>
      callback(transaction),
  };
  const service = new TryOnTaskService(
    { getEntityManager: () => entityManager } as never,
    {} as never,
    {
      getTryOnProduct: async () => {
        counts.catalogReads += 1;
        return product;
      },
    } as never,
    {
      getObject: async () => {
        counts.objectStoreCalls += 1;
        return Buffer.alloc(0);
      },
      putObject: async () => {
        counts.objectStoreCalls += 1;
      },
    } as never,
    {
      bindToTask: async (
        _transaction: unknown,
        _userId: string,
        _photoId: string,
        taskId: string,
      ) => {
        counts.bindings += 1;
        photo.taskId = taskId;
      },
    } as never,
    {
      assertAvailable: async () => undefined,
      incrementInTransaction: async () => {
        counts.quotaWrites += 1;
      },
    } as never,
    new ConfigService({ TRY_ON_ENABLED: 'true', TRY_ON_CONSENT_VERSION: 'v1' }),
  );
  return {
    service,
    photo,
    tasks,
    results,
    counts,
    input: {
      productExternalId: 'coat-1',
      color: '黑色',
      photoId: photo.id,
      consentVersion: 'v1',
    },
    setProduct(next: TryOnProductProjection | null) {
      product = next;
    },
    get product() {
      return product!;
    },
  };
}

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

test('聊天试穿结果仅按本人成功任务读取并返回受检图片字节', async () => {
  const userId = '00000000-0000-4000-8000-000000000002';
  const taskId = '00000000-0000-4000-8000-000000000003';
  const source = Buffer.from('synthetic-image');
  const body = Buffer.from('normalized-synthetic-image');
  const task = Object.assign(new TryOnTask(), {
    id: taskId,
    userId,
    status: TryOnTaskStatus.SUCCEEDED,
    deletedAt: null,
    productExternalId: 'coat-1',
    productName: '试穿大衣',
    color: '黑色',
  });
  const result = Object.assign(new TryOnResult(), {
    taskId,
    userId,
    deletedAt: null,
    objectKey: 'private/try-on/result.webp',
    mimeType: 'image/webp',
    byteSize: source.byteLength,
    width: 1200,
    height: 1600,
  });
  const requestedOwners: string[] = [];
  let objectKeyRead: string | undefined;
  const service = new TryOnTaskService(
    {
      findOne: async (where: { userId: string }) => {
        requestedOwners.push(where.userId);
        return where.userId === userId ? task : null;
      },
    } as never,
    {
      findOne: async (where: { userId: string }) =>
        where.userId === userId ? result : null,
    } as never,
    {} as never,
    {
      getObject: async (objectKey: string) => {
        objectKeyRead = objectKey;
        return source;
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      normalize: async () => ({
        body,
        mimeType: 'image/webp',
        byteSize: body.byteLength,
        width: 1200,
        height: 1600,
      }),
    } as never,
  );

  const loaded = await service.readChatResult(userId, taskId);

  assert.deepEqual(loaded, {
    taskId,
    product: {
      externalId: 'coat-1',
      name: '试穿大衣',
      color: '黑色',
    },
    result: {
      width: 1200,
      height: 1600,
      mimeType: 'image/webp',
    },
    image: body,
  });
  assert.deepEqual(requestedOwners, [userId]);
  assert.equal(objectKeyRead, 'private/try-on/result.webp');
  assert.equal(
    JSON.stringify(loaded).includes('private/try-on/result.webp'),
    false,
  );
  await assert.rejects(service.readChatResult('another-user', taskId), {
    status: 404,
  });
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

test('旧商品链接不能绕过已关闭或失效的试穿设置，拒绝时没有任务、照片和额度副作用', async () => {
  for (const overrides of [
    { tryOnEnabled: false },
    { tryOnEligible: false },
    { category: 'shoes' as const },
  ]) {
    const fixture = createAdmissionFixture();
    fixture.setProduct({ ...fixture.product, ...overrides });
    await assert.rejects(
      fixture.service.create(fixture.photo.userId, fixture.input),
      (error: unknown) =>
        error instanceof ConflictException &&
        (error.getResponse() as { code: string }).code ===
          'PRODUCT_NOT_TRYON_SUPPORTED',
    );
    assert.equal(fixture.tasks.length, 0);
    assert.equal(fixture.results.length, 0);
    assert.equal(fixture.counts.photoReads, 0);
    assert.equal(fixture.counts.bindings, 0);
    assert.equal(fixture.counts.quotaWrites, 0);
    assert.equal(fixture.counts.flushes, 0);
    assert.equal(fixture.counts.objectStoreCalls, 0);
    assert.equal(fixture.photo.taskId, null);
  }
});

test('商品不存在或颜色缺失沿用既有错误，无可用颜色图片时在绑定照片前拒绝', async () => {
  const missing = createAdmissionFixture();
  missing.setProduct(null);
  await assert.rejects(
    missing.service.create(missing.photo.userId, missing.input),
    NotFoundException,
  );
  assert.equal(missing.tasks.length, 0);

  const unknownColor = createAdmissionFixture();
  await assert.rejects(
    unknownColor.service.create(unknownColor.photo.userId, {
      ...unknownColor.input,
      color: '蓝色',
    }),
    (error: unknown) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code: string }).code === 'COLOR_UNAVAILABLE',
  );
  assert.equal(unknownColor.counts.bindings, 0);

  const noImage = createAdmissionFixture();
  noImage.setProduct({
    ...noImage.product,
    mainImageUrl: null,
    colors: [{ color: '黑色', imageUrl: null }],
  });
  await assert.rejects(
    noImage.service.create(noImage.photo.userId, noImage.input),
    (error: unknown) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code: string }).code ===
        'PRODUCT_NOT_TRYON_SUPPORTED',
  );
  assert.equal(noImage.counts.photoReads, 0);
  assert.equal(noImage.counts.bindings, 0);
  assert.equal(noImage.counts.quotaWrites, 0);
  assert.equal(noImage.counts.flushes, 0);
});

test('SKU 图片优先；缺图时使用商品级私有图片快照', async () => {
  const fixture = createAdmissionFixture();
  fixture.setProduct({
    ...fixture.product,
    tryOnImageObjectKey:
      'product-try-on/22345678-1234-1234-1234-123456789abc/42345678-1234-1234-1234-123456789abc.webp',
    colors: [{ color: '黑色', imageUrl: null }],
  });
  const response = await fixture.service.create(
    fixture.photo.userId,
    fixture.input,
  );
  assert.equal(response.status, TryOnTaskStatus.QUEUED);
  assert.equal(fixture.tasks[0]?.garmentImageUrl, null);
  assert.equal(
    fixture.tasks[0]?.garmentImageObjectKey,
    fixture.product.tryOnImageObjectKey,
  );
  assert.equal(fixture.tasks.length, 1);
  assert.equal(fixture.counts.bindings, 1);
  assert.equal(fixture.counts.quotaWrites, 0);

  fixture.setProduct({ ...fixture.product, tryOnEnabled: false });
  const task = fixture.tasks[0]!;
  task.status = TryOnTaskStatus.PROCESSING;
  await fixture.service.markSucceeded(task, {
    objectKey: 'try-on/test/results/result.webp',
    mimeType: 'image/webp',
    byteSize: 100,
    width: 32,
    height: 32,
    providerRequestId: null,
  });
  assert.equal(task.status, TryOnTaskStatus.SUCCEEDED);
  assert.equal(fixture.counts.catalogReads, 1);
  assert.equal(fixture.results.length, 1);
  assert.equal(fixture.counts.quotaWrites, 1);
  assert.equal(fixture.photo.taskId, null);
  assert.equal(fixture.photo.status, TryOnPhotoStatus.ACTIVE);
});
