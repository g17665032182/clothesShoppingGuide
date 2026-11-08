import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictException } from '@nestjs/common';

import { ProductCatalogOrderService } from '../service/product-catalog-order.service.js';

const firstSkuId = '11111111-1111-4111-8111-111111111111';
const secondSkuId = '22222222-2222-4222-8222-222222222222';

function createFixture(
  responses: Array<Array<Record<string, unknown>>> = [],
  transactionContext: object | null = {},
) {
  const calls: Array<{
    query: string;
    parameters: unknown[];
    context: object | undefined;
  }> = [];
  const connection = {
    async execute(
      query: string,
      parameters: unknown[],
      _method: string,
      context: object | undefined,
    ) {
      calls.push({ query, parameters, context });
      return responses[calls.length - 1] ?? [];
    },
  };
  const context = transactionContext;
  const entityManagerLike = {
    getConnection: () => connection,
    getTransactionContext: () => context,
  };

  return {
    calls,
    entityManager: entityManagerLike as never,
    transactionContext: context,
    service: new ProductCatalogOrderService(),
  };
}

test('锁 SKU 前去重并排序，查询使用调用方事务上下文', async () => {
  const { calls, entityManager, transactionContext, service } = createFixture([
    [{ id: firstSkuId }],
    [
      {
        sku_id: firstSkuId,
        product_external_id: 'coat-1',
        external_sku_id: 'coat-1-black-m',
        product_name: '羊毛大衣',
        color: '黑色',
        size: 'M',
        price: '899.00',
        currency: 'CNY',
        stock: 3,
        product_is_active: true,
        sku_is_active: true,
        image_url: null,
      },
    ],
  ]);

  const result = await service.lockSkus(entityManager, [
    secondSkuId,
    firstSkuId,
    firstSkuId,
  ]);

  assert.deepEqual(result, [
    {
      skuId: firstSkuId,
      productExternalId: 'coat-1',
      externalSkuId: 'coat-1-black-m',
      productName: '羊毛大衣',
      color: '黑色',
      size: 'M',
      price: '899.00',
      currency: 'CNY',
      stock: 3,
      isProductActive: true,
      isSkuActive: true,
      imageUrl: null,
    },
  ]);
  assert.deepEqual(calls[0]?.parameters, [firstSkuId, secondSkuId]);
  assert.match(calls[0]?.query ?? '', /where s\.id in \(\?, \?\)/u);
  assert.match(calls[0]?.query ?? '', /order by s\.id asc\s+for update of s/u);
  assert.equal(calls[0]?.context, transactionContext);
  assert.match(calls[1]?.query ?? '', /join products p/u);
  assert.doesNotMatch(calls[1]?.query ?? '', /for update/u);
  assert.equal(calls[1]?.context, transactionContext);
});

test('预占读取来自公开视图并返回 SKU 数量映射', async () => {
  const { calls, entityManager, service } = createFixture([
    [
      { sku_id: firstSkuId, reserved_quantity: '4' },
      { sku_id: secondSkuId, reserved_quantity: '8' },
    ],
  ]);

  const reservations = await service.getReservedQuantities(entityManager, [
    secondSkuId,
    firstSkuId,
  ]);

  assert.deepEqual(
    [...reservations],
    [
      [firstSkuId, 4],
      [secondSkuId, 8],
    ],
  );
  assert.match(calls[0]?.query ?? '', /active_order_sku_reservations/u);
  assert.deepEqual(calls[0]?.parameters, [firstSkuId, secondSkuId]);
  assert.match(calls[0]?.query ?? '', /where sku_id in \(\?, \?\)/u);
});

test('目录变化预读返回稳定 SKU 身份，且查询参数去重排序', async () => {
  const { calls, entityManager, service } = createFixture([
    [
      {
        id: firstSkuId,
        product_external_id: 'coat-1',
        external_sku_id: 'coat-1-black-m',
      },
    ],
  ]);
  const identity = await service.getSkuIdsForCatalogChanges(
    entityManager,
    ['coat-2', 'coat-1', 'coat-1'],
    [
      { productExternalId: 'coat-2', externalSkuId: 'z' },
      { productExternalId: 'coat-1', externalSkuId: 'a' },
      { productExternalId: 'coat-1', externalSkuId: 'a' },
    ],
  );

  assert.deepEqual(identity, [
    {
      skuId: firstSkuId,
      productExternalId: 'coat-1',
      externalSkuId: 'coat-1-black-m',
    },
  ]);
  assert.deepEqual(calls[0]?.parameters, [
    'coat-1',
    'coat-2',
    'coat-1',
    'a',
    'coat-2',
    'z',
  ]);
  assert.match(calls[0]?.query ?? '', /order by s\.id asc/u);
  assert.match(calls[0]?.query ?? '', /p\.external_id in \(\?, \?\)/u);
  assert.match(
    calls[0]?.query ?? '',
    /\(p\.external_id = \? and s\.external_sku_id = \?\)/u,
  );
});

test('发货扣减按 SKU 稳定排序且更新数不足时回滚调用方事务', async () => {
  const { calls, entityManager, service } = createFixture([
    [{ id: firstSkuId }],
    [{ id: secondSkuId }],
  ]);

  await service.decrementStockForShipment(entityManager, [
    { skuId: secondSkuId, quantity: 2 },
    { skuId: firstSkuId, quantity: 1 },
  ]);

  assert.deepEqual(
    calls.map(({ parameters }) => parameters),
    [
      [1, firstSkuId, 1],
      [2, secondSkuId, 2],
    ],
  );
  assert.ok(calls.every((call) => /stock >= \?/u.test(call.query)));

  const missingSku = createFixture([[]]);
  await assert.rejects(
    missingSku.service.decrementStockForShipment(missingSku.entityManager, [
      { skuId: firstSkuId, quantity: 1 },
    ]),
    ConflictException,
  );
});

test('库存端口必须加入调用方已开启的事务', async () => {
  const { entityManager, service } = createFixture([], null);

  await assert.rejects(
    service.lockSkus(entityManager, [firstSkuId]),
    /必须加入调用方事务/u,
  );
  await assert.rejects(
    service.getReservedQuantities(entityManager, [firstSkuId]),
    /必须加入调用方事务/u,
  );
});
