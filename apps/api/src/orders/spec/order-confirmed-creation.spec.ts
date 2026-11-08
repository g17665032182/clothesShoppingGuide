import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import type { ProductCatalogOrderSku } from '../../product-catalog/index.js';
import { createOrderSchema } from '../dto/create-order.dto.js';
import { OrderIdempotency } from '../entity/order-idempotency.entity.js';
import { OrderItem } from '../entity/order-item.entity.js';
import { Order } from '../entity/order.entity.js';
import type {
  ConfirmedOrderInput,
  ConfirmedOrderSnapshot,
} from '../port/order-confirmed-creation.port.js';
import { OrdersService } from '../service/orders.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const skuId = '22222222-2222-4222-8222-222222222222';
const secondSkuId = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const actualTime = new Date('2026-11-08T12:00:00Z');
const transactionTime = new Date('2026-11-08T11:00:00Z');

function input(): ConfirmedOrderInput {
  return {
    idempotencyKey: key,
    items: [{ skuId, quantity: 2 }],
    recipient: {
      name: '测试收件人',
      phone: '13800138000',
      address: '测试地址',
    },
  };
}

function snapshot(): ConfirmedOrderSnapshot {
  return {
    productExternalId: 'coat-1',
    skuId,
    productName: '测试外套',
    color: '黑色',
    size: 'M',
    unitPrice: '10.05',
    currency: 'CNY',
    imageUrl: 'https://example.com/image.png',
    expiresAt: new Date('2026-11-09T12:00:00Z'),
  };
}

function fixture() {
  const orders: Order[] = [];
  const items: OrderItem[] = [];
  const keys: OrderIdempotency[] = [];
  const events: string[] = [];
  const context = {};
  let clock = actualTime;
  let flushCount = 0;
  let failureFlush = 0;
  let transaction: object | null = context;
  let lockCallback = () => {};
  const skus: ProductCatalogOrderSku[] = [
    {
      skuId,
      productExternalId: 'coat-1',
      externalSkuId: 'coat-black-m',
      productName: '测试外套',
      color: '黑色',
      size: 'M',
      price: '10.05',
      currency: 'CNY',
      imageUrl: 'https://example.com/image.png',
      stock: 10,
      isProductActive: true,
      isSkuActive: true,
    },
  ];
  const reserved = new Map<string, number>();
  const rows = (entity: unknown) =>
    entity === Order ? orders : entity === OrderItem ? items : keys;
  const em = {
    getTransactionContext: () => transaction,
    getConnection: () => ({
      async execute(
        sql: string,
        _params: unknown[],
        _method: string,
        tx: unknown,
      ) {
        assert.equal(tx, context);
        if (sql.includes('pg_advisory')) {
          events.push('idempotency');
          return [];
        }
        events.push(sql.includes('clock_timestamp()') ? 'clock' : 'now');
        return [
          {
            database_now: sql.includes('clock_timestamp()')
              ? clock
              : transactionTime,
          },
        ];
      },
    }),
    async findOne(entity: unknown, where: object) {
      return (
        rows(entity).find((row) =>
          Object.entries(where).every(
            ([key, value]) =>
              (row as unknown as Record<string, unknown>)[key] === value,
          ),
        ) ?? null
      );
    },
    async findOneOrFail(entity: unknown, where: object) {
      const value = await this.findOne(entity, where);
      assert.ok(value);
      return value;
    },
    async find(entity: unknown, where: { orderId?: string }) {
      return entity === OrderItem
        ? items.filter((item) => item.orderId === where.orderId)
        : [];
    },
    create(entity: new () => object, data: object) {
      events.push('write');
      const value = Object.assign(new entity(), data);
      (rows(entity) as object[]).push(value);
      return value;
    },
    persist() {},
    async flush() {
      flushCount += 1;
      if (flushCount === failureFlush)
        throw new Error('injected-write-failure');
    },
  };
  const catalog = {
    async lockSkus(manager: unknown, ids: string[]) {
      assert.equal(manager, em);
      assert.deepEqual(ids, [...ids].sort());
      events.push('sku-lock');
      lockCallback();
      return skus.filter((sku) => ids.includes(sku.skuId));
    },
    async getReservedQuantities(manager: unknown) {
      assert.equal(manager, em);
      events.push('reserved');
      return reserved;
    },
  };
  const repository = {
    getEntityManager() {
      throw new Error('confirmed-path-must-not-fork');
    },
  };
  const service = new OrdersService(repository as never, catalog as never);
  return {
    service,
    em: em as never,
    events,
    orders,
    items,
    keys,
    skus,
    reserved,
    setClock: (value: Date) => {
      clock = value;
    },
    withoutTransaction: () => {
      transaction = null;
    },
    onLock: (callback: () => void) => {
      lockCallback = callback;
    },
    failFlush: (count: number) => {
      failureFlush = count;
    },
    legacyService: () =>
      new OrdersService(
        {
          getEntityManager: () => ({
            fork: () => ({
              transactional: (callback: (manager: unknown) => unknown) =>
                callback(em),
            }),
          }),
        } as never,
        catalog as never,
      ),
  };
}

test('确认下单加入原 EM，锁后按实际数据库时间创建，金额精确且不另开事务', async () => {
  const f = fixture();
  const result = await f.service.createConfirmedInTransaction(
    f.em,
    userId,
    input(),
    snapshot(),
  );
  assert.equal(result.kind, 'created');
  assert.ok('order' in result);
  assert.equal(result.order.itemsAmount, '20.10');
  assert.equal(result.order.createdAt, actualTime.toISOString());
  assert.equal(result.order.expiresAt, '2026-11-08T12:30:00.000Z');
  assert.equal(f.keys.length, 1);
  assert.deepEqual(f.events.slice(0, 5), [
    'idempotency',
    'sku-lock',
    'reserved',
    'clock',
    'write',
  ]);
  assert.equal('requestHash' in result.order, false);
});

test('商品身份、名称、颜色、尺码、币种、单价和图片变化均不能绕过确认', async () => {
  const changes: Array<Partial<ProductCatalogOrderSku>> = [
    { productExternalId: 'another-product' },
    { productName: '新名称' },
    { color: '白色' },
    { size: 'L' },
    { price: '10.06' },
    { imageUrl: 'https://example.com/changed.png' },
  ];
  for (const change of changes) {
    const f = fixture();
    Object.assign(f.skus[0]!, change);
    assert.deepEqual(
      await f.service.createConfirmedInTransaction(
        f.em,
        userId,
        input(),
        snapshot(),
      ),
      { kind: 'quote_changed' },
    );
    assert.equal(f.events.includes('write'), false);
    assert.equal(f.keys.length, 0);
  }
  for (const change of [
    { isProductActive: false },
    { isSkuActive: false },
    { currency: 'USD' },
  ]) {
    const f = fixture();
    Object.assign(f.skus[0]!, change);
    assert.deepEqual(
      await f.service.createConfirmedInTransaction(
        f.em,
        userId,
        input(),
        snapshot(),
      ),
      { kind: 'unavailable' },
    );
    assert.equal(f.events.includes('write'), false);
  }
});

test('缺失 SKU、派生预占不足均返回安全结果，无部分订单、明细或幂等记录', async () => {
  const missing = fixture();
  missing.skus.length = 0;
  assert.deepEqual(
    await missing.service.createConfirmedInTransaction(
      missing.em,
      userId,
      input(),
      snapshot(),
    ),
    { kind: 'unavailable' },
  );
  const insufficient = fixture();
  insufficient.reserved.set(skuId, 9);
  assert.deepEqual(
    await insufficient.service.createConfirmedInTransaction(
      insufficient.em,
      userId,
      input(),
      snapshot(),
    ),
    { kind: 'insufficient_stock' },
  );
  for (const f of [missing, insufficient]) {
    assert.deepEqual(
      [f.orders.length, f.items.length, f.keys.length],
      [0, 0, 0],
    );
  }
});

test('锁等待跨草稿期限和精确等于截止均拒绝，不使用事务起始 now()', async () => {
  for (const passed of [0, 1]) {
    const f = fixture();
    const expected = {
      ...snapshot(),
      expiresAt: new Date(actualTime.getTime() + 1000),
    };
    f.onLock(() => f.setClock(new Date(expected.expiresAt.getTime() + passed)));
    assert.deepEqual(
      await f.service.createConfirmedInTransaction(
        f.em,
        userId,
        input(),
        expected,
      ),
      { kind: 'draft_expired' },
    );
    assert.equal(f.events.includes('write'), false);
  }
});

test('原成功请求先重放，忽略之后过期/下架/价格变化，内容变化仍冲突', async () => {
  const f = fixture();
  const first = await f.service.createConfirmedInTransaction(
    f.em,
    userId,
    input(),
    snapshot(),
  );
  assert.ok('order' in first);
  f.skus[0]!.isProductActive = false;
  f.skus[0]!.price = '99.99';
  const result = await f.service.createConfirmedInTransaction(
    f.em,
    userId,
    input(),
    {
      ...snapshot(),
      expiresAt: transactionTime,
      unitPrice: '1.00',
    },
  );
  assert.equal(result.kind, 'replayed');
  assert.ok('order' in result);
  assert.equal(result.order.id, first.order.id);
  assert.equal(result.order.itemsAmount, '20.10');
  assert.equal(f.orders.length, 1);
  assert.equal(f.keys.length, 1);
  await assert.rejects(
    f.service.createConfirmedInTransaction(
      f.em,
      userId,
      {
        ...input(),
        recipient: { ...input().recipient, address: '另一地址' },
      },
      snapshot(),
    ),
    ConflictException,
  );
});

test('图片比较与公开投影采用同一 URL 规范化，非法图片不进入新订单', async () => {
  const f = fixture();
  f.skus[0]!.imageUrl = 'javascript:alert(1)';
  const result = await f.service.createConfirmedInTransaction(
    f.em,
    userId,
    input(),
    {
      ...snapshot(),
      imageUrl: null,
    },
  );
  assert.ok('order' in result);
  assert.equal(result.order.items[0]?.imageUrl, null);
});

test('非法事务调用或多 SKU 确认不会写入，数据库错误交给调用方回滚', async () => {
  const f = fixture();
  f.withoutTransaction();
  await assert.rejects(
    f.service.createConfirmedInTransaction(f.em, userId, input(), snapshot()),
    /调用方事务/u,
  );
  const multiple = fixture();
  await assert.rejects(
    multiple.service.createConfirmedInTransaction(
      multiple.em,
      userId,
      {
        ...input(),
        items: [
          { skuId, quantity: 1 },
          { skuId: secondSkuId, quantity: 1 },
        ],
      } as never,
      snapshot(),
    ),
    BadRequestException,
  );
  assert.equal(multiple.events.length, 0);
  const broken = fixture();
  broken.failFlush(2);
  await assert.rejects(
    broken.service.createConfirmedInTransaction(
      broken.em,
      userId,
      input(),
      snapshot(),
    ),
    /injected-write-failure/u,
  );
  assert.equal(broken.keys.length, 0);
});

test('旧 API 仍支持多 SKU、排序幂等、原事务时间与原 404/409 行为', async () => {
  const f = fixture();
  f.skus.push({ ...f.skus[0]!, skuId: secondSkuId, price: '0.10' });
  const legacy = f.legacyService();
  const request = createOrderSchema.parse({
    ...input(),
    items: [
      { skuId: secondSkuId, quantity: 3 },
      { skuId, quantity: 2 },
    ],
  });
  const result = await legacy.createForUser(userId, request);
  assert.equal(result.created, true);
  assert.equal(result.order.itemsAmount, '20.40');
  assert.equal(result.order.createdAt, transactionTime.toISOString());
  assert.equal(result.order.items.length, 2);
  const retry = await legacy.createForUser(userId, {
    ...request,
    items: [...request.items].reverse(),
  });
  assert.equal(retry.created, false);
  assert.equal(retry.order.id, result.order.id);
  const missing = fixture();
  missing.skus.length = 0;
  await assert.rejects(
    missing.legacyService().createForUser(userId, input()),
    NotFoundException,
  );
  const insufficient = fixture();
  insufficient.reserved.set(skuId, 9);
  await assert.rejects(
    insufficient.legacyService().createForUser(userId, input()),
    ConflictException,
  );
  assert.equal(insufficient.orders.length, 0);
});
