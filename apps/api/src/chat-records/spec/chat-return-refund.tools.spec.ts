import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGetMyReturnRefundItemsTool,
  createListMyReturnRefundOrdersTool,
  createReturnRefundApplicationTool,
} from '../tools/chat-return-refund.tools.js';

const userId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const orderItemId = '44444444-4444-4444-8444-444444444444';

test('本人售后订单候选和商品查询由服务端绑定身份并经过严格投影', async () => {
  const seenUsers: string[] = [];
  const requested: string[] = [];
  const reader = {
    listOrdersForChat: async (id: string) => {
      seenUsers.push(id);
      return [
        {
          id: orderId,
          orderNo: 'ORDER-1',
          status: 'completed' as const,
          completedAt: '2026-11-18T08:00:00.000Z',
          currency: 'CNY' as const,
          itemCount: 1,
        },
      ];
    },
    getOrderOptionsForChat: async (id: string, selectedOrderId: string) => {
      seenUsers.push(id);
      assert.equal(selectedOrderId, orderId);
      return {
        orderId,
        orderNo: 'ORDER-1',
        status: 'completed' as const,
        completedAt: '2026-11-18T08:00:00.000Z',
        currency: 'CNY' as const,
        items: [
          {
            orderItemId,
            productName: '夹克',
            productExternalId: 'jacket-1',
            color: '黑色',
            size: 'M',
            imageUrl: null,
            unitPrice: '99.00',
            quantity: 2,
            availableQuantity: 2,
          },
        ],
      };
    },
  };

  const list = createListMyReturnRefundOrdersTool(reader as never, userId, () =>
    requested.push('orders'),
  );
  const options = createGetMyReturnRefundItemsTool(
    reader as never,
    userId,
    () => requested.push('items'),
  );

  assert.deepEqual(JSON.parse(String(await list.invoke({}))), {
    ok: true,
    items: [
      {
        id: orderId,
        orderNo: 'ORDER-1',
        status: 'completed',
        completedAt: '2026-11-18T08:00:00.000Z',
        currency: 'CNY',
        itemCount: 1,
      },
    ],
  });
  assert.deepEqual(JSON.parse(String(await options.invoke({ orderId }))), {
    ok: true,
    order: {
      orderId,
      orderNo: 'ORDER-1',
      status: 'completed',
      completedAt: '2026-11-18T08:00:00.000Z',
      currency: 'CNY',
      items: [
        {
          orderItemId,
          productName: '夹克',
          productExternalId: 'jacket-1',
          color: '黑色',
          size: 'M',
          imageUrl: null,
          unitPrice: '99.00',
          quantity: 2,
          availableQuantity: 2,
        },
      ],
    },
  });
  assert.deepEqual(seenUsers, [userId, userId]);
  assert.deepEqual(requested, ['orders', 'items']);
  await assert.rejects(options.invoke({ orderId, userId } as never));
});

test('申请创建只经专用工具调用，绑定身份与 tool-call 幂等键且不返回原因', async () => {
  const calls: unknown[] = [];
  const service = {
    createDraftFromChat: async (
      id: string,
      input: unknown,
      idempotencyKey: string,
    ) => {
      calls.push({ id, input, idempotencyKey });
      return {
        applicationId: '55555555-5555-4555-8555-555555555555',
        orderNo: 'ORDER-1',
        status: 'pending_user_submission' as const,
        currency: 'CNY' as const,
        refundAmount: '99.00',
        items: [{ productName: '夹克', color: '黑色', size: 'M', quantity: 1 }],
      };
    },
  };
  let requested = 0;
  const create = createReturnRefundApplicationTool(
    service as never,
    userId,
    conversationId,
    () => requested++,
  );
  const invocation = await create.invoke(
    {
      orderId,
      items: [{ orderItemId, quantity: 1 }],
      reason: '尺码不合适，用户私密原因',
    },
    {
      toolCall: {
        id: 'tool-call-1',
        name: 'create_return_refund_application',
        args: {},
        type: 'tool_call',
      },
    } as never,
  );
  const output =
    typeof invocation === 'string'
      ? invocation
      : String((invocation as { content: unknown }).content);

  assert.deepEqual(JSON.parse(output), {
    ok: true,
    applicationId: '55555555-5555-4555-8555-555555555555',
    orderNo: 'ORDER-1',
    status: 'pending_user_submission',
    currency: 'CNY',
    refundAmount: '99.00',
    items: [{ productName: '夹克', color: '黑色', size: 'M', quantity: 1 }],
  });
  assert.equal(output.includes('用户私密原因'), false);
  assert.equal(requested, 1);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { id: string }).id, userId);
  assert.deepEqual((calls[0] as { input: unknown }).input, {
    orderId,
    items: [{ orderItemId, quantity: 1 }],
    reason: '尺码不合适，用户私密原因',
  });
  assert.match(
    (calls[0] as { idempotencyKey: string }).idempotencyKey,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  await create.invoke(
    {
      orderId,
      items: [{ orderItemId, quantity: 1 }],
      reason: '尺码不合适，用户私密原因',
    },
    {
      toolCall: {
        id: 'tool-call-1',
        name: 'create_return_refund_application',
        args: {},
        type: 'tool_call',
      },
    } as never,
  );
  assert.equal(calls.length, 2);
  assert.equal(
    (calls[0] as { idempotencyKey: string }).idempotencyKey,
    (calls[1] as { idempotencyKey: string }).idempotencyKey,
  );
});
