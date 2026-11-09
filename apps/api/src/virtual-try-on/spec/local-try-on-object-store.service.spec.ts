import 'reflect-metadata';

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  Module,
  ServiceUnavailableException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { LocalPrivateObjectStorageService } from '../../common/storage/local-private-object-storage.service.js';
import { TryOnLocalAssetController } from '../controller/try-on-local-asset.controller.js';
import { LocalTryOnObjectStoreService } from '../service/local-try-on-object-store.service.js';

const userId = '12345678-1234-4234-8234-123456789abc';
const objectId = '22345678-1234-4234-8234-123456789abc';
const secret = 'local-storage-test-secret-that-is-long-enough';

test('开发本地试穿存储读写私有文件并校验短期下载签名', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'try-on-local-'));
  const config = new ConfigService({
    NODE_ENV: 'development',
    TRY_ON_STORAGE_DRIVER: 'local',
    TRY_ON_LOCAL_STORAGE_PATH: directory,
    TRY_ON_LOCAL_PUBLIC_URL: 'http://localhost:3000',
    JWT_SECRET: secret,
  });
  const store = new LocalTryOnObjectStoreService(
    config,
    new LocalPrivateObjectStorageService(config),
  );
  try {
    const key = await store.putResult({
      userId,
      id: objectId,
      body: Buffer.from('private-result'),
      mimeType: 'image/webp',
    });
    assert.equal(key, `try-on/${userId}/results/${objectId}.webp`);
    assert.equal((await store.getObject(key)).toString(), 'private-result');

    const url = new URL(await store.getPrivateDownloadUrl(key, 300));
    assert.equal(url.origin, 'http://localhost:3000');
    assert.match(url.pathname, /^\/api\/try-on\/local-assets\//u);
    assert.equal(url.toString().includes(key), false);
    assert.equal(url.pathname.split('/').at(-1)?.split('.').length, 3);
    const token = url.pathname.split('/').at(-1);
    assert.ok(token);
    const downloaded = await store.getSignedObject(token);
    assert.equal(downloaded.body.toString(), 'private-result');
    assert.equal(downloaded.mimeType, 'image/webp');
    await assert.rejects(
      store.getSignedObject(`${token}tampered`),
      ServiceUnavailableException,
    );

    await store.deleteObject(key);
    await store.deleteObject(key);
    await assert.rejects(store.getObject(key), ServiceUnavailableException);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('本地试穿对象存储拒绝非开发环境和非规范对象键', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'try-on-local-'));
  const config = new ConfigService({
    NODE_ENV: 'production',
    TRY_ON_STORAGE_DRIVER: 'local',
    TRY_ON_LOCAL_STORAGE_PATH: directory,
    JWT_SECRET: secret,
  });
  const store = new LocalTryOnObjectStoreService(
    config,
    new LocalPrivateObjectStorageService(config),
  );
  try {
    await assert.rejects(
      store.putPhoto({
        userId,
        id: objectId,
        body: Buffer.from('photo'),
        mimeType: 'image/webp',
      }),
      ServiceUnavailableException,
    );
    await assert.rejects(
      store.getObject(`try-on/${userId}/../results/${objectId}.webp`),
      ServiceUnavailableException,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('本地签名结果路由免 Bearer 读取、禁缓存并拒绝篡改令牌', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'try-on-local-http-'));
  const config = new ConfigService({
    NODE_ENV: 'development',
    TRY_ON_STORAGE_DRIVER: 'local',
    TRY_ON_LOCAL_STORAGE_PATH: directory,
    TRY_ON_LOCAL_PUBLIC_URL: 'http://localhost:3000',
    JWT_SECRET: secret,
  });
  @Module({
    controllers: [TryOnLocalAssetController],
    providers: [
      { provide: ConfigService, useValue: config },
      {
        provide: LocalPrivateObjectStorageService,
        useValue: new LocalPrivateObjectStorageService(config),
      },
      {
        provide: LocalTryOnObjectStoreService,
        useValue: new LocalTryOnObjectStoreService(
          config,
          new LocalPrivateObjectStorageService(config),
        ),
      },
    ],
  })
  class FixtureModule {}

  Reflect.defineMetadata(
    'design:paramtypes',
    [LocalTryOnObjectStoreService],
    TryOnLocalAssetController,
  );
  const app = await NestFactory.create(FixtureModule, {
    logger: ['error', 'warn'],
  });
  const reflector = new Reflector();
  const jwt = new JwtService({ secret });
  app.useGlobalGuards(
    new JwtAuthGuard(jwt, reflector, {
      findActiveById: async () => null,
    } as never),
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  try {
    const store = app.get(LocalTryOnObjectStoreService);
    const key = await store.putResult({
      userId,
      id: objectId,
      body: Buffer.from('http-private-result'),
      mimeType: 'image/png',
    });
    const url = new URL(await store.getPrivateDownloadUrl(key, 60));
    url.host = new URL(await app.getUrl()).host;
    const token = url.pathname.split('/').at(-1);
    assert.ok(token);
    assert.equal(
      (await store.getSignedObject(token)).body.toString(),
      'http-private-result',
    );
    assert.equal(
      (
        await app.get(LocalTryOnObjectStoreService).getSignedObject(token)
      ).body.toString(),
      'http-private-result',
    );
    assert.ok(await app.get(TryOnLocalAssetController).download({ token }));

    const response = await fetch(url);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(
      response.headers.get('cross-origin-resource-policy'),
      'cross-origin',
    );
    assert.equal(await response.text(), 'http-private-result');

    const invalid = await fetch(
      `${await app.getUrl()}/api/try-on/local-assets/${token}x`,
    );
    assert.equal(invalid.status, 404);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
