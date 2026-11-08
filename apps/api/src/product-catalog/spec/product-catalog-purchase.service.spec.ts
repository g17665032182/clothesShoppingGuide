import assert from 'node:assert/strict';
import test from 'node:test';

import { ServiceUnavailableException } from '@nestjs/common';

import { ProductCatalogPurchaseService } from '../service/product-catalog-purchase.service.js';

function skuRow(index: number, total: number, inStock = true) {
  return {
    product_external_id: 'coat-1',
    product_name: '测试大衣',
    sku_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    color: `颜色${index}`,
    size: 'M',
    unit_price: '99.90',
    currency: 'CNY',
    in_stock: inStock,
    image_url: 'https://example.com/image.png',
    total_skus: String(total),
    stock: 999,
    reserved_quantity: 998,
  };
}

function fixture(rows: unknown[], transaction: object | null = {}) {
  const calls: Array<{ sql: string; params: unknown[]; context: unknown }> = [];
  const em = {
    getTransactionContext: () => transaction,
    getConnection: () => ({
      execute: async (
        sql: string,
        params: unknown[],
        _method: string,
        context: unknown,
      ) => {
        calls.push({ sql, params, context });
        return rows;
      },
    }),
  };
  return {
    calls,
    transaction,
    em: em as never,
    service: new ProductCatalogPurchaseService(),
  };
}

test('超过默认分页仍读取完整规格，不能将第一页唯一有货误判为唯一规格', async () => {
  const rows = Array.from({ length: 21 }, (_, index) =>
    skuRow(index + 1, 21, index === 0 || index === 20),
  );
  const { calls, em, service, transaction } = fixture(rows);
  const result = await service.getPurchaseSpecifications(em, 'coat-1');
  assert.equal(result?.skus.length, 21);
  assert.equal(result?.skus.filter((sku) => sku.inStock).length, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.params, [101, 'coat-1']);
  assert.equal(calls[0]?.context, transaction);
  assert.match(calls[0]?.sql ?? '', /count\(\*\) over/u);
  assert.match(calls[0]?.sql ?? '', /active_order_sku_reservations/u);
  assert.equal(JSON.stringify(result).includes('stock'), false);
  assert.equal(JSON.stringify(result).includes('reserved_quantity'), false);
});

test('完整一百规格可读取，只有集合中真正唯一有货才得到一个选择', async () => {
  const { em, service } = fixture(
    Array.from({ length: 100 }, (_, index) => skuRow(index, 100, index === 99)),
  );
  const result = await service.getPurchaseSpecifications(em, 'coat-1');
  assert.equal(result?.skus.length, 100);
  assert.equal(result?.skus.filter((sku) => sku.inStock).length, 1);
});

test('有界集合超限、截断、重复及计数漂移均失败，不返回错误的唯一规格', async () => {
  for (const rows of [
    [skuRow(1, 101)],
    [skuRow(1, 2)],
    [skuRow(1, 2), skuRow(1, 2)],
    [skuRow(1, 2), skuRow(2, 1)],
    [skuRow(1, -1)],
  ]) {
    const { em, service } = fixture(rows);
    await assert.rejects(
      service.getPurchaseSpecifications(em, 'coat-1'),
      ServiceUnavailableException,
    );
  }
});

test('不存在商品与有效但空规格明确区分，非法图片安全归一化', async () => {
  const missing = fixture([]);
  assert.equal(
    await missing.service.getPurchaseSpecifications(missing.em, 'coat-1'),
    null,
  );
  const empty = fixture([
    {
      ...skuRow(1, 0),
      sku_id: null,
      total_skus: null,
    },
  ]);
  assert.deepEqual(
    await empty.service.getPurchaseSpecifications(empty.em, 'coat-1'),
    { productExternalId: 'coat-1', productName: '测试大衣', skus: [] },
  );
  const unsafeImage = fixture([
    { ...skuRow(1, 1), image_url: 'javascript:alert(1)' },
  ]);
  assert.equal(
    (
      await unsafeImage.service.getPurchaseSpecifications(
        unsafeImage.em,
        'coat-1',
      )
    )?.skus[0]?.imageUrl,
    null,
  );
});

test('损坏规格和无调用方事务不会被解释成无货或空集合', async () => {
  for (const row of [
    { ...skuRow(1, 1), currency: 'USD' },
    { ...skuRow(1, 1), unit_price: 'NaN' },
    { ...skuRow(1, 1), in_stock: null },
  ]) {
    const { em, service } = fixture([row]);
    await assert.rejects(
      service.getPurchaseSpecifications(em, 'coat-1'),
      ServiceUnavailableException,
    );
  }
  const { em, service, calls } = fixture([], null);
  await assert.rejects(
    service.getPurchaseSpecifications(em, 'coat-1'),
    /调用方事务/u,
  );
  assert.equal(calls.length, 0);
});
