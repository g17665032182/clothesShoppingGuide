import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { TryOnPhotoService } from '../service/try-on-photo.service.js';
import { TryOnPhotoKind } from '../entity/try-on-photo.entity.js';

const testBody = Buffer.from('synthetic-public-test-image');
const testDigest = createHash('sha256').update(testBody).digest('hex');

function createService(configValues: Record<string, string>) {
  let createdPhoto: Record<string, unknown> | undefined;
  let listFilter: unknown;
  const photoRepository = {
    find: async (filter: unknown) => {
      listFilter = filter;
      return [];
    },
    create: (input: Record<string, unknown>) => {
      createdPhoto = Object.assign(
        { id: '00000000-0000-4000-8000-000000000001' },
        input,
      );
      return createdPhoto;
    },
    getEntityManager: () => ({ flush: async () => undefined }),
  };
  const objectStore = {
    putPhoto: async () => 'try-on/user/photos/photo.webp',
    deleteObject: async () => undefined,
  };
  const imageProcessing = {
    normalize: async (body: Buffer) => ({
      body,
      mimeType: 'image/webp',
      byteSize: body.byteLength,
      width: 100,
      height: 100,
    }),
  };
  const config = {
    get: (key: string) => configValues[key],
  };
  return {
    service: new TryOnPhotoService(
      photoRepository as never,
      objectStore as never,
      imageProcessing as never,
      config as never,
    ),
    objectStore,
    get createdPhoto() {
      return createdPhoto;
    },
    get listFilter() {
      return listFilter;
    },
  };
}

test('默认关闭时拒绝照片上传', async () => {
  const { service } = createService({});
  await assert.rejects(
    () => service.upload('user-id', { buffer: testBody }, false),
    (error: unknown) =>
      error instanceof ConflictException && error.getStatus() === 409,
  );
});

test('照片列表提前报告上传准入状态，不暴露白名单且保持本人隔离', async () => {
  const cases = [
    { config: {}, availability: 'disabled' },
    {
      config: { TRY_ON_ENABLED: 'true', NODE_ENV: 'development' },
      availability: 'test_images_unconfigured',
    },
    {
      config: {
        TRY_ON_ENABLED: 'true',
        NODE_ENV: 'development',
        TRY_ON_ALLOWED_TEST_IMAGE_SHA256: 'invalid',
      },
      availability: 'test_images_unconfigured',
    },
    {
      config: {
        TRY_ON_ENABLED: 'true',
        NODE_ENV: 'development',
        TRY_ON_REAL_PHOTOS_ENABLED: 'true',
      },
      availability: 'test_images_unconfigured',
    },
    {
      config: {
        TRY_ON_ENABLED: 'true',
        NODE_ENV: 'development',
        TRY_ON_ALLOWED_TEST_IMAGE_SHA256: testDigest,
      },
      availability: 'test_only',
    },
    {
      config: {
        TRY_ON_ENABLED: 'true',
        NODE_ENV: 'production',
        TRY_ON_ALLOWED_TEST_IMAGE_SHA256: testDigest,
      },
      availability: 'disabled',
    },
    {
      config: {
        TRY_ON_ENABLED: 'true',
        NODE_ENV: 'production',
        TRY_ON_REAL_PHOTOS_ENABLED: 'true',
      },
      availability: 'available',
    },
    {
      config: {
        TRY_ON_ENABLED: 'false',
        NODE_ENV: 'production',
        TRY_ON_REAL_PHOTOS_ENABLED: 'true',
      },
      availability: 'disabled',
    },
  ];
  for (const entry of cases) {
    const fixture = createService(entry.config as Record<string, string>);
    const result = await fixture.service.listSaved('current-user');
    assert.deepEqual(result, {
      items: [],
      availability: entry.availability,
    });
    assert.deepEqual(fixture.listFilter, {
      userId: 'current-user',
      kind: 'saved',
      status: 'active',
    });
  }
});

test('开发测试模式只接受规范化后命中服务端 SHA-256 白名单的图片', async () => {
  const { service } = createService({
    TRY_ON_ENABLED: 'true',
    TRY_ON_REAL_PHOTOS_ENABLED: 'false',
    NODE_ENV: 'test',
    TRY_ON_ALLOWED_TEST_IMAGE_SHA256: testDigest,
  });

  const response = await service.upload(
    '00000000-0000-4000-8000-000000000002',
    { buffer: testBody, mimetype: 'image/jpeg', size: testBody.byteLength },
    false,
  );
  assert.equal(response.kind, TryOnPhotoKind.TEMPORARY);
  assert.equal(response.mimeType, 'image/webp');
  assert.equal('objectKey' in response, false);
});

test('未配置白名单、未登记图片和生产测试白名单均拒绝上传', async () => {
  const noAllowlist = createService({
    TRY_ON_ENABLED: 'true',
    NODE_ENV: 'test',
  }).service;
  const mismatch = createService({
    TRY_ON_ENABLED: 'true',
    NODE_ENV: 'test',
    TRY_ON_ALLOWED_TEST_IMAGE_SHA256: 'a'.repeat(64),
  }).service;
  const production = createService({
    TRY_ON_ENABLED: 'true',
    NODE_ENV: 'production',
    TRY_ON_ALLOWED_TEST_IMAGE_SHA256: testDigest,
  }).service;

  for (const service of [noAllowlist, mismatch, production]) {
    await assert.rejects(
      () =>
        service.upload(
          '00000000-0000-4000-8000-000000000002',
          { buffer: testBody },
          true,
        ),
      (error: unknown) =>
        error instanceof BadRequestException && error.getStatus() === 400,
    );
  }
});

test('临时照片上传返回有限摘要且默认设定短期过期', async () => {
  const fixture = createService({
    TRY_ON_ENABLED: 'true',
    NODE_ENV: 'test',
    TRY_ON_ALLOWED_TEST_IMAGE_SHA256: testDigest,
  });
  const before = Date.now();
  const response = await fixture.service.upload(
    '00000000-0000-4000-8000-000000000002',
    { buffer: testBody },
    false,
  );
  assert.equal(response.kind, TryOnPhotoKind.TEMPORARY);
  assert.ok(response.createdAt);
  assert.equal(
    Object.keys(response).some((key) => key.toLowerCase().includes('url')),
    false,
  );
  const expiresAt = fixture.createdPhoto?.expiresAt;
  assert.ok(expiresAt instanceof Date);
  assert.ok(expiresAt.getTime() - before >= 29 * 60 * 1000);
  assert.ok(expiresAt.getTime() - before <= 30 * 60 * 1000 + 1_000);
  assert.ok(Date.now() >= before);
});
