import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { ZodError } from 'zod';

import {
  adminOrderQuerySchema,
  customerOrderQuerySchema,
} from '../dto/order-query.dto.js';
import { createOrderSchema } from '../dto/create-order.dto.js';
import { orderIdSchema } from '../dto/order-id.dto.js';
import {
  emptyOrderActionSchema,
  shipOrderSchema,
} from '../dto/ship-order.dto.js';

const ownerId = '54b8b9fc-9d24-49e8-9d28-b52bff3fa110';
const firstSkuId = '54b8b9fc-9d24-49e8-9d28-b52bff3fa111';

const validCreateOrder = {
  idempotencyKey: '54b8b9fc-9d24-49e8-9d28-b52bff3fa113',
  items: [{ skuId: firstSkuId, quantity: 2 }],
  recipient: {
    name: ' 林女士 ',
    phone: '+8613800138000',
    address: ' 上海市浦东新区示例路 1 号 ',
  },
};

function plain<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

test('创建订单 schema 规范化收件信息并拒绝客户端控制字段', () => {
  assert.deepEqual(plain(createOrderSchema.parse(validCreateOrder)), {
    ...validCreateOrder,
    recipient: {
      name: '林女士',
      phone: '+8613800138000',
      address: '上海市浦东新区示例路 1 号',
    },
  });

  for (const input of [
    { ...validCreateOrder, amount: '0.01' },
    { ...validCreateOrder, userId: ownerId },
    { ...validCreateOrder, status: 'pending_shipment' },
    {
      ...validCreateOrder,
      recipient: { ...validCreateOrder.recipient, extra: true },
    },
  ]) {
    assert.equal(createOrderSchema.safeParse(input).success, false);
  }
});

test('创建订单 schema 限制 SKU 去重、数量和收件字段边界', () => {
  assert.equal(
    createOrderSchema.safeParse({
      ...validCreateOrder,
      items: [
        { skuId: firstSkuId, quantity: 1 },
        { skuId: firstSkuId, quantity: 2 },
      ],
    }).success,
    false,
  );
  assert.equal(
    createOrderSchema.safeParse({
      ...validCreateOrder,
      items: [{ skuId: firstSkuId, quantity: '2' }],
    }).success,
    false,
  );
  assert.equal(
    createOrderSchema.safeParse({
      ...validCreateOrder,
      items: [{ skuId: firstSkuId, quantity: 100 }],
    }).success,
    false,
  );
  assert.equal(
    createOrderSchema.safeParse({
      ...validCreateOrder,
      recipient: { ...validCreateOrder.recipient, phone: '138-0013-8000' },
    }).success,
    false,
  );
  assert.equal(
    createOrderSchema.safeParse({
      ...validCreateOrder,
      recipient: { ...validCreateOrder.recipient, address: '\u0000' },
    }).success,
    false,
  );
  assert.equal(
    createOrderSchema.safeParse({
      ...validCreateOrder,
      recipient: { ...validCreateOrder.recipient, name: null },
    }).success,
    false,
  );
});

test('本人及管理员订单列表 Query 默认分页、转换参数并隔离 userId', () => {
  assert.deepEqual(plain(customerOrderQuerySchema.parse({})), {
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(
    plain(
      customerOrderQuerySchema.parse({
        page: '3',
        pageSize: '40',
        orderNo: ' ORD-2026-001 ',
        status: 'pending_payment',
      }),
    ),
    {
      page: 3,
      pageSize: 40,
      orderNo: 'ORD-2026-001',
      status: 'pending_payment',
    },
  );
  assert.deepEqual(plain(adminOrderQuerySchema.parse({ userId: ownerId })), {
    page: 1,
    pageSize: 20,
    userId: ownerId,
  });
  assert.equal(
    customerOrderQuerySchema.safeParse({ userId: ownerId }).success,
    false,
  );

  for (const query of [
    { page: '0' },
    { page: '1.5' },
    { page: '' },
    { pageSize: '101' },
    { status: 'refunded' },
    { unknown: 'value' },
    { status: null },
  ]) {
    assert.equal(customerOrderQuerySchema.safeParse(query).success, false);
  }
  assert.equal(
    adminOrderQuerySchema.safeParse({ userId: 'invalid' }).success,
    false,
  );
});

test('订单路径参数和发货请求严格校验', () => {
  assert.equal(orderIdSchema.safeParse({ id: firstSkuId }).success, true);
  assert.equal(orderIdSchema.safeParse({ id: 'not-a-uuid' }).success, false);
  assert.equal(
    orderIdSchema.safeParse({ id: firstSkuId, userId: ownerId }).success,
    false,
  );
  assert.deepEqual(
    plain(
      shipOrderSchema.parse({
        carrier: ' 顺丰 ',
        trackingNo: ' SF123456 ',
      }),
    ),
    { carrier: '顺丰', trackingNo: 'SF123456' },
  );
  assert.equal(
    shipOrderSchema.safeParse({ carrier: ' ', trackingNo: 'x' }).success,
    false,
  );
  assert.equal(
    shipOrderSchema.safeParse({
      carrier: '快递',
      trackingNo: '单号\u0000非法',
    }).success,
    false,
  );
  assert.equal(
    shipOrderSchema.safeParse({
      carrier: '快递',
      trackingNo: 'SF123',
      status: 'pending_receipt',
    }).success,
    false,
  );
});

test('空动作 Body 拒绝附带支付金额或状态', () => {
  assert.deepEqual(emptyOrderActionSchema.parse({}), {});
  assert.equal(emptyOrderActionSchema.safeParse({ amount: 1 }).success, false);
  assert.equal(emptyOrderActionSchema.safeParse(null).success, false);
});

test('订单创建和路由参数 Schema 由 Nest 标准 Pipe 映射为 HTTP 400', async () => {
  const pipe = new StandardSchemaValidationPipe();

  await assert.rejects(
    pipe.transform(
      { ...validCreateOrder, unknown: true },
      { type: 'body', schema: createOrderSchema },
    ),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
  await assert.rejects(
    pipe.transform(
      { id: 'not-a-uuid' },
      { type: 'param', schema: orderIdSchema },
    ),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
  assert.throws(() => createOrderSchema.parse({}), ZodError);
});
