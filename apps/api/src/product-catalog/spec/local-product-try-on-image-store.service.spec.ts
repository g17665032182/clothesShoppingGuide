import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LocalPrivateObjectStorageService } from '../../common/storage/local-private-object-storage.service.js';
import { LocalProductTryOnImageStoreService } from '../service/local-product-try-on-image-store.service.js';

const productId = '12345678-1234-4234-8234-123456789abc';
const assetId = '22345678-1234-4234-8234-123456789abc';

test('开发本地商品试穿图存储使用隔离对象键并支持清理', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'product-try-on-local-'));
  const config = new ConfigService({
    NODE_ENV: 'development',
    TRY_ON_STORAGE_DRIVER: 'local',
    TRY_ON_LOCAL_STORAGE_PATH: directory,
  });
  const store = new LocalProductTryOnImageStoreService(
    config,
    new LocalPrivateObjectStorageService(config),
  );
  try {
    const key = await store.putImage({
      productId,
      assetId,
      body: Buffer.from('normalized-webp'),
    });
    assert.equal(key, `product-try-on/${productId}/${assetId}.webp`);
    assert.equal((await store.getObject(key)).toString(), 'normalized-webp');
    await store.deleteObject(key);
    await assert.rejects(store.getObject(key), ServiceUnavailableException);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('本地商品试穿图存储仅允许 development 环境', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'product-try-on-local-'));
  const config = new ConfigService({
    NODE_ENV: 'test',
    TRY_ON_STORAGE_DRIVER: 'local',
    TRY_ON_LOCAL_STORAGE_PATH: directory,
  });
  const store = new LocalProductTryOnImageStoreService(
    config,
    new LocalPrivateObjectStorageService(config),
  );
  try {
    await assert.rejects(
      store.putImage({
        productId,
        assetId,
        body: Buffer.from('normalized-webp'),
      }),
      ServiceUnavailableException,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
