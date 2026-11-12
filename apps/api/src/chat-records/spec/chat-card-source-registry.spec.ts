import assert from 'node:assert/strict';
import test from 'node:test';

import { chatCardSelectionSchema } from '../display/chat-display.projection.js';
import { createChatCardDisplayTool } from '../display/chat-card-display.tool.js';
import { createChatCardSourceRegistry } from '../display/chat-card-source-registry.js';
import type {
  ChatOrderCardSummary,
  ChatProductCard,
} from '../display/chat-display.types.js';

function product(externalId: string): ChatProductCard {
  return {
    externalId,
    name: `商品 ${externalId}`,
    brand: null,
    category: 'tops',
    description: null,
    imageUrl: null,
    productUrl: null,
    price: '99.00',
    currency: 'CNY',
    sizes: ['M'],
    colors: ['黑色'],
    inStock: true,
    tryOnEnabled: false,
    matchReasons: ['size_match'],
  };
}

function order(orderNo: string): ChatOrderCardSummary {
  return {
    orderNo,
    status: 'pending_shipment',
    closeReason: null,
    itemsAmount: '99.00',
    payableAmount: '99.00',
    itemCount: 1,
    createdAt: '2026-11-10T01:00:00.000Z',
    paidAt: '2026-11-10T01:05:00.000Z',
    shippedAt: null,
    completedAt: null,
    items: [
      {
        productName: '商品 A',
        color: '黑色',
        size: 'M',
        quantity: 1,
      },
    ],
  };
}

test('卡片选择严格拒绝空值、重复引用、超量和额外业务字段', () => {
  for (const input of [
    { name: 'product', externalIds: [] },
    { name: 'product', externalIds: ['coat-1', 'coat-1'] },
    {
      name: 'product',
      externalIds: ['1', '2', '3', '4', '5', '6'],
    },
    { name: 'product', externalIds: ['coat-1'], price: '1.00' },
    { name: 'order', orderNos: ['ORDER-1'], status: 'closed' },
    { name: 'unknown', externalIds: ['coat-1'] },
  ]) {
    assert.equal(chatCardSelectionSchema.safeParse(input).success, false);
  }
});

test('来源登记器只从安全领域结果物化卡片并隔离实例状态', () => {
  const first = createChatCardSourceRegistry();
  const second = createChatCardSourceRegistry();
  first.registerProducts({
    items: [product('coat-1')],
    nextCursor: null,
    noResultReason: null,
  });
  first.registerOrders([order('ORDER-1')]);

  assert.deepEqual(
    first.createCard({ name: 'product', externalIds: ['coat-1'] }),
    {
      type: 'card',
      name: 'product',
      data: { items: [product('coat-1')] },
    },
  );
  assert.deepEqual(first.createCard({ name: 'order', orderNos: ['ORDER-1'] }), {
    type: 'card',
    name: 'order',
    data: { items: [order('ORDER-1')] },
  });
  assert.throws(
    () => second.createCard({ name: 'product', externalIds: ['coat-1'] }),
    /不属于本轮查询/u,
  );
  assert.throws(
    () => second.createCard({ name: 'order', orderNos: ['ORDER-1'] }),
    /不属于本轮查询/u,
  );
});

test('展示工具在成功物化后调用暂存回调，并安全降级无效引用和暂存失败', async () => {
  const registry = createChatCardSourceRegistry();
  registry.registerProducts({
    items: [product('coat-1')],
    nextCursor: null,
    noResultReason: null,
  });
  const staged: unknown[] = [];
  const displayTool = createChatCardDisplayTool(registry, (card) => {
    staged.push(card);
    return card;
  });
  const raw = await displayTool.invoke({
    name: 'product',
    externalIds: ['coat-1'],
  });

  assert.deepEqual(JSON.parse(String(raw)), {
    type: 'card',
    name: 'product',
    data: { items: [product('coat-1')] },
  });
  assert.equal(staged.length, 1);

  const missing = await displayTool.invoke({
    name: 'product',
    externalIds: ['unknown'],
  });
  assert.deepEqual(JSON.parse(String(missing)), {
    ok: false,
    code: 'invalid_reference',
  });

  const failingTool = createChatCardDisplayTool(registry, () => {
    throw new Error('private budget details');
  });
  const failed = await failingTool.invoke({
    name: 'product',
    externalIds: ['coat-1'],
  });
  assert.deepEqual(JSON.parse(String(failed)), {
    ok: false,
    code: 'unavailable',
  });
  assert.equal(String(failed).includes('private budget details'), false);
});
