import assert from 'node:assert/strict';
import test from 'node:test';

import { OrderStatus } from '../entity/order.entity.js';
import {
  createListUserOrdersTool,
  listUserOrdersToolSchema,
} from '../tool/list-user-orders.tool.js';

const ownerId = '11111111-1111-4111-8111-111111111111';

function makeSummary(id: string) {
  return {
    id,
    orderNo: `ORDER-${id}`,
    status: OrderStatus.PENDING_SHIPMENT,
    closeReason: null,
    itemsAmount: '99.00',
    shippingAmount: '0.00',
    discountAmount: '0.00',
    payableAmount: '99.00',
    currency: 'CNY' as const,
    paymentMode: 'simulated' as const,
    itemCount: 2,
    expiresAt: '2026-11-10T01:00:00.000Z',
    createdAt: '2026-11-09T01:00:00.000Z',
    paidAt: '2026-11-09T01:05:00.000Z',
    shippedAt: '2026-11-09T02:00:00.000Z',
    completedAt: null,
    closedAt: null,
    userId: 'must-not-leak',
    recipient: {
      name: '隐私姓名',
      phone: '13800138000',
      address: '仅用于测试的完整地址',
    },
    shipment: { carrier: '测试物流', trackingNo: 'PRIVATE-TRACKING' },
    requestHash: 'private-idempotency-hash',
  };
}

function makeDetail(id: string) {
  return {
    ...makeSummary(id),
    items: [
      {
        skuId: 'private-sku-id',
        productExternalId: 'private-external-id',
        productName: '羊毛大衣',
        color: '黑色',
        size: 'M',
        imageUrl: 'https://example.invalid/private-image',
        unitPrice: '49.50',
        quantity: 2,
        lineAmount: '99.00',
      },
    ],
  };
}

test('订单工具只绑定本人、固定最多五条并投影安全摘要', async () => {
  const calls: Array<{ method: string; userId: string; value: unknown }> = [];
  const summaries = Array.from({ length: 6 }, (_, index) =>
    makeSummary(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
  );
  const service = {
    async listCancelableForUser() {
      return [];
    },
    async listForUser(userId: string, query: unknown) {
      calls.push({ method: 'list', userId, value: query });
      return { items: summaries, total: 6, page: 1, pageSize: 5 };
    },
    async getForUser(userId: string, id: string) {
      calls.push({ method: 'detail', userId, value: id });
      return makeDetail(id);
    },
  };
  const orderTool = createListUserOrdersTool(service as never, ownerId);

  const raw = await orderTool.invoke({
    orderNo: ' ORDER-1 ',
    status: OrderStatus.PENDING_SHIPMENT,
    page: 1,
  });
  const output = JSON.parse(String(raw)) as {
    ok: boolean;
    orders: Array<Record<string, unknown>>;
  };

  assert.equal(output.ok, true);
  assert.equal(output.orders.length, 5);
  const listCall = calls[0];
  assert.equal(listCall?.method, 'list');
  assert.equal(listCall?.userId, ownerId);
  assert.deepEqual(JSON.parse(JSON.stringify(listCall?.value)), {
    page: 1,
    pageSize: 5,
    orderNo: 'ORDER-1',
    status: OrderStatus.PENDING_SHIPMENT,
  });
  assert.equal(calls.filter((call) => call.method === 'detail').length, 5);
  assert.ok(calls.every((call) => call.userId === ownerId));
  assert.deepEqual(Object.keys(output.orders[0] ?? {}).sort(), [
    'closeReason',
    'completedAt',
    'createdAt',
    'itemCount',
    'items',
    'itemsAmount',
    'orderNo',
    'paidAt',
    'payableAmount',
    'shippedAt',
    'status',
  ]);
  assert.deepEqual(output.orders[0]?.items, [
    {
      productName: '羊毛大衣',
      color: '黑色',
      size: 'M',
      quantity: 2,
    },
  ]);
  const serialized = JSON.stringify(output);
  for (const privateValue of [
    ownerId,
    'must-not-leak',
    '隐私姓名',
    '13800138000',
    '仅用于测试的完整地址',
    'PRIVATE-TRACKING',
    'private-idempotency-hash',
    'private-sku-id',
    'private-external-id',
    'shippingAmount',
    'discountAmount',
    'currency',
    'paymentMode',
    'expiresAt',
    'closedAt',
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
});

test('订单工具严格拒绝 userId、未知字段及不合法筛选', async () => {
  for (const input of [
    { userId: ownerId },
    { unknown: true },
    { page: 11 },
    { page: 0 },
    { status: 'not-a-status' },
    { orderNo: '  ' },
  ]) {
    assert.equal(listUserOrdersToolSchema.safeParse(input).success, false);
  }
  assert.deepEqual(listUserOrdersToolSchema.parse({}), { page: 1 });
});

test('待付款筛选走未过期候选查询并仅增加卡片引用白名单', async () => {
  const summary = {
    ...makeSummary('33333333-3333-4333-8333-333333333333'),
    status: OrderStatus.PENDING_PAYMENT,
    expiresAt: '2026-11-10T01:00:00.000Z',
  };
  let candidateUserId = '';
  let listCalled = false;
  const orderTool = createListUserOrdersTool(
    {
      async listCancelableForUser(userId: string) {
        candidateUserId = userId;
        return [summary] as never;
      },
      async listForUser() {
        listCalled = true;
        return { items: [], total: 0, page: 1, pageSize: 5 };
      },
      async getForUser(userId: string, id: string) {
        assert.equal(userId, ownerId);
        assert.equal(id, summary.id);
        return makeDetail(id) as never;
      },
    } as never,
    ownerId,
  );

  const output = JSON.parse(
    String(
      await orderTool.invoke({
        status: OrderStatus.PENDING_PAYMENT,
        page: 1,
      }),
    ),
  ) as { ok: boolean; orders: Array<Record<string, unknown>> };

  assert.equal(candidateUserId, ownerId);
  assert.equal(listCalled, false);
  assert.equal(output.orders.length, 1);
  assert.equal(output.orders[0]?.orderId, summary.id);
  assert.equal(output.orders[0]?.expiresAt, summary.expiresAt);
  assert.deepEqual(Object.keys(output.orders[0] ?? {}).sort(), [
    'cancelable',
    'createdAt',
    'expiresAt',
    'items',
    'orderId',
    'orderNo',
    'payableAmount',
    'status',
  ]);
  const serialized = JSON.stringify(output);
  for (const privateValue of [
    ownerId,
    '隐私姓名',
    '13800138000',
    '仅用于测试的完整地址',
    'PRIVATE-TRACKING',
    'private-idempotency-hash',
    'private-sku-id',
    'private-external-id',
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
});

test('订单工具把 service 异常映射为不含内部信息的通用结果', async () => {
  const orderTool = createListUserOrdersTool(
    {
      async listCancelableForUser() {
        return [];
      },
      async listForUser() {
        throw new Error('private database connection detail');
      },
      async getForUser() {
        throw new Error('unused');
      },
    } as never,
    ownerId,
  );

  assert.deepEqual(JSON.parse(String(await orderTool.invoke({}))), {
    ok: false,
    code: 'unavailable',
  });
});
