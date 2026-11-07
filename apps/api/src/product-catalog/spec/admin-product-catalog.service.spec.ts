import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';

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
    service: new AdminProductCatalogService(repository as never),
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
  assert.equal('internal_secret' in result.items[0]!, false);
  assert.equal(result.total, 1);
  assert.deepEqual(calls[1]?.params.slice(-2), [10, 10]);
  assert.match(calls[1]?.sql ?? '', /order by p\.updated_at desc, p\.id desc/u);
  assert.match(calls[0]?.sql ?? '', /active_order_sku_reservations/u);
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
