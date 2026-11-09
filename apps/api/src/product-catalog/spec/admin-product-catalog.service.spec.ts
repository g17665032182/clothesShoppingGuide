import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { LockMode } from '@mikro-orm/core';

import { AdminProductCatalogService } from '../service/admin-product-catalog.service.js';
import { adminProductQuerySchema } from '../dto/admin-product-query.dto.js';

const productId = '54b8b9fc-9d24-49e8-9d28-b52bff3fa110';
const row = {
  id: productId,
  external_id: 'coat-1',
  name: '测试大衣',
  brand: '测试品牌',
  category: 'outerwear',
  product_url: null,
  is_active: false,
  try_on_enabled: true,
  sku_count: '1',
  lowest_price: '899.00',
  total_stock: '5',
  total_available_stock: '3',
  created_at: new Date('2026-11-07T00:00:00Z'),
  updated_at: new Date('2026-11-07T01:00:00Z'),
  internal_secret: 'must-not-return',
};

function fixture(responses: unknown[][]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const repository = {
    getEntityManager: () => ({
      getConnection: () => ({
        execute: async (sql: string, params: unknown[]) => {
          calls.push({ sql, params });
          return responses[calls.length - 1] ?? [];
        },
      }),
    }),
  };
  return {
    service: new AdminProductCatalogService(repository as never, {} as never),
    calls,
  };
}

test('管理员商品列表分页与安全投影保留精确库存且不返回 Entity 私有字段', async () => {
  const { service, calls } = fixture([[{ total: '1' }], [row]]);
  const result = await service.list(
    adminProductQuerySchema.parse({
      page: '2',
      pageSize: '10',
      keyword: '大衣',
      isActive: 'false',
      inStock: 'true',
    }),
  );
  assert.equal(result.items[0]?.totalStock, 5);
  assert.equal(result.items[0]?.totalAvailableStock, 3);
  assert.equal(result.items[0]?.isActive, false);
  assert.equal(result.items[0]?.tryOnEnabled, true);
  assert.equal('internal_secret' in result.items[0]!, false);
  assert.equal(result.total, 1);
  assert.deepEqual(calls[1]?.params.slice(-2), [10, 10]);
  assert.match(calls[1]?.sql ?? '', /order by p\.updated_at desc, p\.id desc/u);
  assert.match(calls[0]?.sql ?? '', /active_order_sku_reservations/u);
});

function updateFixture(eligible: boolean, initial = false, exists = true) {
  const product = {
    id: productId,
    externalId: 'coat-1',
    tryOnEnabled: initial,
    updatedAt: new Date(0),
  };
  let flushes = 0;
  let qualificationReads = 0;
  const transaction = {
    findOne: async (_entity: unknown, where: unknown, options: unknown) => {
      assert.deepEqual(where, { id: productId });
      assert.deepEqual(options, { lockMode: LockMode.PESSIMISTIC_WRITE });
      return exists ? product : null;
    },
    flush: async () => {
      flushes++;
    },
  };
  const service = new AdminProductCatalogService(
    {
      getEntityManager: () => ({
        fork: () => ({
          transactional: async (callback: (manager: unknown) => unknown) =>
            callback(transaction),
        }),
      }),
    } as never,
    {
      getTryOnProduct: async (id: string, manager: unknown) => {
        qualificationReads++;
        assert.equal(id, 'coat-1');
        assert.equal(manager, transaction);
        return { tryOnEligible: eligible };
      },
    } as never,
  );
  service.detail = async () =>
    ({ id: productId, tryOnEnabled: product.tryOnEnabled }) as never;
  return {
    service,
    product,
    flushes: () => flushes,
    qualificationReads: () => qualificationReads,
  };
}

test('试穿开关事务更新只改变设置，重复保存幂等且允许失效商品关闭', async () => {
  const fixture = updateFixture(true);
  assert.equal(
    (await fixture.service.updateTryOn(productId, { tryOnEnabled: true }))
      .tryOnEnabled,
    true,
  );
  assert.equal(fixture.flushes(), 1);
  assert.ok(fixture.product.updatedAt.getTime() > 0);
  await fixture.service.updateTryOn(productId, { tryOnEnabled: true });
  assert.equal(fixture.flushes(), 1);
  const disabled = updateFixture(false, true);
  assert.equal(
    (await disabled.service.updateTryOn(productId, { tryOnEnabled: false }))
      .tryOnEnabled,
    false,
  );
  assert.equal(disabled.qualificationReads(), 0);
});

test('开启资格不足或商品不存在拒绝，未写入设置', async () => {
  const fixture = updateFixture(false);
  await assert.rejects(
    fixture.service.updateTryOn(productId, { tryOnEnabled: true }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(
        (error.getResponse() as { code: string }).code,
        'PRODUCT_NOT_TRYON_SUPPORTED',
      );
      return true;
    },
  );
  assert.equal(fixture.product.tryOnEnabled, false);
  assert.equal(fixture.flushes(), 0);
  await assert.rejects(
    updateFixture(false, false, false).service.updateTryOn(productId, {
      tryOnEnabled: false,
    }),
    NotFoundException,
  );
});

test('商品详情包含下架 SKU 和当前预占，找不到资源返回404', async () => {
  const { service } = fixture([
    [{ ...row, description: null, styles: [], occasions: ['通勤'], fits: [] }],
    [
      {
        id: productId,
        external_sku_id: 'coat-1-m',
        color: '黑色',
        size: 'M',
        price: '899.00',
        currency: 'CNY',
        stock: 5,
        reserved_stock: '2',
        image_url: null,
        is_active: false,
      },
    ],
  ]);
  const result = await service.detail(productId);
  assert.equal(result.skus[0]?.reservedStock, 2);
  assert.equal(result.skus[0]?.availableStock, 3);
  assert.equal(result.skus[0]?.isActive, false);
  await assert.rejects(
    fixture([[]]).service.detail(productId),
    NotFoundException,
  );
});
