import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';

import { Order, OrderStatus } from '../entity/order.entity.js';
import { OrderItem } from '../entity/order-item.entity.js';
import { OrdersService } from '../service/orders.service.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';

function makeOrder(userId = ownerId): Order {
  return Object.assign(new Order(), {
    id: orderId,
    orderNo: 'OD-20261107-example',
    userId,
    status: OrderStatus.PENDING_PAYMENT,
    closeReason: null,
    currency: 'CNY',
    itemsAmount: '1798.00',
    shippingAmount: '0.00',
    discountAmount: '0.00',
    payableAmount: '1798.00',
    paymentMode: 'simulated',
    recipientName: '林女士',
    recipientPhone: '13800138000',
    recipientAddress: '上海市示例地址 1 号',
    shipmentCarrier: null,
    shipmentTrackingNo: null,
    expiresAt: new Date('2026-11-07T01:30:00.000Z'),
    paidAt: null,
    shippedAt: null,
    completedAt: null,
    closedAt: null,
    createdAt: new Date('2026-11-07T01:00:00.000Z'),
    updatedAt: new Date('2026-11-07T01:00:00.000Z'),
    requestHash: 'private-idempotency-digest',
  });
}

function makeItem(): OrderItem {
  return Object.assign(new OrderItem(), {
    id: '44444444-4444-4444-8444-444444444444',
    orderId,
    skuId: '55555555-5555-4555-8555-555555555555',
    productExternalId: 'coat-1',
    productName: '羊毛大衣',
    color: '黑色',
    size: 'M',
    imageUrl: null,
    unitPrice: '899.00',
    quantity: 2,
    lineAmount: '1798.00',
  });
}

function createService(
  options: {
    order?: Order | null;
    orders?: Order[];
    items?: OrderItem[];
  } = {},
) {
  const calls: unknown[] = [];
  const selectedOrder =
    options.order === undefined ? makeOrder() : options.order;
  const orders = options.orders ?? (selectedOrder ? [selectedOrder] : []);
  const items = options.items ?? [makeItem()];
  const entityManager = {
    async findOne(entity: unknown, where: unknown) {
      calls.push({ method: 'findOne', entity, where });
      if (entity === Order) {
        const condition = where as Partial<Order>;
        return (
          orders.find(
            (order) =>
              order.id === condition.id &&
              (condition.userId === undefined ||
                order.userId === condition.userId),
          ) ?? null
        );
      }
      return null;
    },
    async find(entity: unknown, where: unknown) {
      calls.push({ method: 'find', entity, where });
      if (entity === OrderItem) {
        const condition = where as {
          orderId?: string | { $in?: string[] };
        };
        const orderIds =
          typeof condition.orderId === 'string'
            ? [condition.orderId]
            : (condition.orderId?.$in ?? []);
        return items.filter((item) => orderIds.includes(item.orderId));
      }
      return [];
    },
    async findAndCount(entity: unknown, where: unknown, query: unknown) {
      calls.push({ method: 'findAndCount', entity, where, query });
      const condition = where as Partial<Order>;
      const filtered = orders.filter(
        (order) =>
          (condition.userId === undefined ||
            order.userId === condition.userId) &&
          (condition.status === undefined ||
            order.status === condition.status) &&
          (condition.orderNo === undefined ||
            order.orderNo === condition.orderNo),
      );
      return [filtered, filtered.length] as const;
    },
  };
  const repository = {
    getEntityManager: () => ({ fork: () => entityManager }),
  };
  const catalog = {};

  return {
    calls,
    service: new OrdersService(repository as never, catalog as never),
  };
}

test('本人详情在查询条件中同时约束订单 ID 和当前用户', async () => {
  const { calls, service } = createService();
  const detail = await service.getForUser(ownerId, orderId);

  assert.deepEqual(calls[0], {
    method: 'findOne',
    entity: Order,
    where: { id: orderId, userId: ownerId },
  });
  assert.equal(detail.paymentMode, 'simulated');
  assert.equal(detail.itemCount, 2);
  assert.equal('userId' in detail, false);
  assert.equal('recipientName' in detail, false);
  assert.equal('requestHash' in detail, false);
  assert.deepEqual(detail.recipient, {
    name: '林女士',
    phone: '13800138000',
    address: '上海市示例地址 1 号',
  });
});

test('本人访问他人订单返回 NotFound，避免泄露订单是否存在', async () => {
  const { calls, service } = createService({ order: null });

  await assert.rejects(
    service.getForUser(ownerId, orderId),
    (error: unknown) =>
      error instanceof NotFoundException && error.getStatus() === 404,
  );
  assert.deepEqual(calls[0], {
    method: 'findOne',
    entity: Order,
    where: { id: orderId, userId: ownerId },
  });
});

test('本人列表只按当前用户筛选，摘要不返回收件信息', async () => {
  const { calls, service } = createService({
    orders: [makeOrder(ownerId), makeOrder(otherUserId)],
  });
  const page = await service.listForUser(ownerId, {
    page: 1,
    pageSize: 20,
  } as never);

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.itemCount, 2);
  assert.equal('userId' in (page.items[0] ?? {}), false);
  assert.equal('recipient' in (page.items[0] ?? {}), false);
  assert.equal(
    calls.some(
      (call) =>
        (call as { method?: string }).method === 'findAndCount' &&
        (call as { where?: { userId?: string } }).where?.userId === ownerId,
    ),
    true,
  );
});

test('管理员订单详情仅增加用户标识，仍使用字段白名单', async () => {
  const { service } = createService({ order: makeOrder(otherUserId) });
  const detail = await service.getForAdmin(orderId);

  assert.equal(detail.userId, otherUserId);
  assert.equal(detail.paymentMode, 'simulated');
  assert.equal('requestHash' in detail, false);
  assert.equal('idempotencyKey' in detail, false);
});
