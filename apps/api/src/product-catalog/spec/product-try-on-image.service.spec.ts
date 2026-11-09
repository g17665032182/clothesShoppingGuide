import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { LockMode } from '@mikro-orm/core';

import { Product } from '../entity/product.entity.js';
import type { ProductTryOnImageStore } from '../port/product-try-on-image-store.port.js';
import { ProductTryOnImageService } from '../service/product-try-on-image.service.js';
import { ProductTryOnImageProcessingService } from '../service/product-try-on-image-processing.service.js';

const productId = '12345678-1234-1234-1234-123456789abc';
const key = `product-try-on/${productId}/22345678-1234-1234-1234-123456789abc.webp`;

function fixture(
  options: { exists?: boolean; hasImage?: boolean; failFlush?: boolean } = {},
) {
  const product = Object.assign(new Product(), {
    id: productId,
    tryOnImageKey: options.hasImage ? key : null,
  });
  const events: string[] = [];
  const store: ProductTryOnImageStore = {
    putImage: async ({ body }) => {
      assert.equal(body.toString(), 'normalized');
      events.push('put');
      return key;
    },
    getObject: async (objectKey) => {
      assert.equal(objectKey, key);
      return Buffer.from('image');
    },
    deleteObject: async (objectKey) => {
      assert.equal(objectKey, key);
      events.push('delete');
    },
  };
  const transaction = {
    findOne: async (_entity: unknown, criteria: unknown, options: unknown) => {
      assert.equal(_entity, Product);
      assert.deepEqual(criteria, { id: productId });
      assert.deepEqual(options, { lockMode: LockMode.PESSIMISTIC_WRITE });
      return options_.exists === false ? null : product;
    },
    flush: async () => {
      events.push('flush');
      if (options.failFlush) {
        product.tryOnImageKey = null;
        throw new Error('database internals must not escape');
      }
    },
  };
  const options_ = options;
  const service = new ProductTryOnImageService(
    {
      getEntityManager: () => ({
        fork: () => ({
          transactional: async (
            callback: (manager: typeof transaction) => unknown,
          ) => callback(transaction),
          findOne: async () => product,
        }),
      }),
    } as never,
    store,
    {
      normalize: async () => Buffer.from('normalized'),
    } as unknown as ProductTryOnImageProcessingService,
  );
  return { service, events, product };
}

test('商品图上传锁定商品、保存私有键并提供受控预览', async () => {
  const { service, events, product } = fixture();
  await service.upload(productId, { buffer: Buffer.from('source') });
  assert.deepEqual(events, ['put', 'flush']);
  assert.equal(product.tryOnImageKey, key);
  assert.equal((await service.preview(productId)).toString(), 'image');
});

test('重复上传与不存在商品不覆盖图片；数据库失败补偿删除私有对象', async () => {
  const duplicate = fixture({ hasImage: true });
  await assert.rejects(
    duplicate.service.upload(productId, { buffer: Buffer.from('source') }),
    ConflictException,
  );
  assert.deepEqual(duplicate.events, []);

  const missing = fixture({ exists: false });
  await assert.rejects(
    missing.service.upload(productId, { buffer: Buffer.from('source') }),
    NotFoundException,
  );
  assert.deepEqual(missing.events, []);

  const failed = fixture({ failFlush: true });
  await assert.rejects(
    failed.service.upload(productId, { buffer: Buffer.from('source') }),
    /商品试穿图片保存失败/u,
  );
  assert.deepEqual(failed.events, ['put', 'flush', 'delete']);
  assert.equal(failed.product.tryOnImageKey, null);
});
