import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminReturnRefundQuerySchema,
  createAndSubmitReturnRefundSchema,
  createReturnRefundDraftSchema,
  emptyReturnRefundActionSchema,
  rejectReturnRefundSchema,
  returnRefundShipmentSchema,
  returnRefundUserQuerySchema,
  returnRefundVersionSchema,
} from '../dto/return-refund.schema.js';

const orderId = '11111111-1111-4111-8111-111111111111';
const orderItemId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';

test('聊天草稿严格解析申请商品与退货原因', () => {
  assert.deepEqual(
    createReturnRefundDraftSchema.parse({
      orderId,
      items: [{ orderItemId, quantity: 2 }],
      reason: '尺码不合适',
    }),
    {
      orderId,
      items: [{ orderItemId, quantity: 2 }],
      reason: '尺码不合适',
    },
  );
});

test('直接申请必须提供幂等键并拒绝身份、金额和状态字段', () => {
  const body = {
    items: [{ orderItemId, quantity: 1 }],
    reason: '商品不合适',
    idempotencyKey,
  };
  assert.equal(createAndSubmitReturnRefundSchema.safeParse(body).success, true);
  for (const input of [
    { ...body, userId: orderId },
    { ...body, refundAmount: '0.01' },
    { ...body, status: 'refunded' },
    { ...body, items: [{ orderItemId, quantity: 1.5 }] },
    { ...body, items: [{ orderItemId, quantity: 0 }] },
    {
      ...body,
      items: [
        { orderItemId, quantity: 1 },
        { orderItemId, quantity: 1 },
      ],
    },
  ]) {
    assert.equal(
      createAndSubmitReturnRefundSchema.safeParse(input).success,
      false,
    );
  }
});

test('动作、物流和原因 schema 拒绝未知字段与控制字符', () => {
  assert.equal(emptyReturnRefundActionSchema.safeParse({}).success, true);
  assert.equal(
    emptyReturnRefundActionSchema.safeParse({ status: 'refunded' }).success,
    false,
  );
  assert.equal(
    returnRefundVersionSchema.safeParse({ version: 1 }).success,
    true,
  );
  assert.equal(
    returnRefundVersionSchema.safeParse({ version: 1, amount: '1.00' }).success,
    false,
  );
  assert.equal(
    returnRefundShipmentSchema.safeParse({
      carrier: '承运商',
      trackingNo: 'TRACK-1',
      version: 1,
    }).success,
    true,
  );
  assert.equal(
    returnRefundShipmentSchema.safeParse({
      carrier: '承运商\n注入',
      trackingNo: 'TRACK-1',
      version: 1,
    }).success,
    false,
  );
  assert.equal(
    rejectReturnRefundSchema.safeParse({
      reason: '审核理由',
      version: 1,
      status: 'refunded',
    }).success,
    false,
  );
});

test('用户与管理员分页 query 有界且拒绝未知筛选', () => {
  assert.deepEqual(returnRefundUserQuerySchema.parse({}), {
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(
    returnRefundUserQuerySchema.parse({ page: '2', pageSize: '30' }),
    { page: 2, pageSize: 30 },
  );
  assert.equal(
    returnRefundUserQuerySchema.safeParse({ page: 0 }).success,
    false,
  );
  assert.equal(
    returnRefundUserQuerySchema.safeParse({ pageSize: 101 }).success,
    false,
  );
  assert.deepEqual(
    adminReturnRefundQuerySchema.parse({
      manualReviewRequired: 'true',
    }),
    { page: 1, pageSize: 20, manualReviewRequired: true },
  );
  assert.equal(
    adminReturnRefundQuerySchema.safeParse({ userId: orderId }).success,
    false,
  );
});
