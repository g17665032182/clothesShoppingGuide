import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatProductSkusTool } from '../tools/chat-product-skus.tool.js';

const page = {
  ok: true,
  productExternalId: 'coat-1',
  items: [
    {
      color: '黑色',
      size: 'M',
      unitPrice: '199.00',
      currency: 'CNY',
      inStock: true,
    },
  ],
  page: 1,
  pageSize: 5,
  total: 1,
  hasNext: false,
};

test('SKU 工具在读取前标记来源，二次投影丢弃内部字段且不改动原结果', async () => {
  let marked = false;
  const inputs: unknown[] = [];
  const result = {
    ...page,
    internalId: 'private-product-id',
    items: [{ ...page.items[0], skuId: 'private-sku-id', stockQuantity: 999 }],
  };
  const original = structuredClone(result);
  const query = createChatProductSkusTool(
    {
      listForChat: async (input) => {
        assert.equal(marked, true);
        inputs.push(input);
        return result as never;
      },
    },
    () => {
      marked = true;
    },
  );
  const output = JSON.parse(
    await query.invoke({ productExternalId: ' coat-1 ' }),
  );
  assert.deepEqual(output, page);
  assert.deepEqual(inputs, [{ productExternalId: 'coat-1', page: 1 }]);
  assert.deepEqual(result, original);
  assert.equal(query.name, 'get_product_skus');
});

test('SKU 工具严格拒绝身份、动作、强制转换和越界参数，非法输入不标记来源', async () => {
  let calls = 0;
  let marks = 0;
  const query = createChatProductSkusTool(
    {
      listForChat: async () => {
        calls += 1;
        return { ok: false, code: 'not_found' };
      },
    },
    () => {
      marks += 1;
    },
  );
  for (const extra of [
    { userId: 'other-user' },
    { skuId: 'private-sku-id' },
    { action: 'purchase' },
    { page: '1' },
    { page: 0 },
    { page: 11 },
    { page: 1.5 },
    { color: ' ' },
  ]) {
    await assert.rejects(() =>
      query.invoke({ productExternalId: 'coat-1', ...extra } as never),
    );
  }
  assert.equal(calls, 0);
  assert.equal(marks, 0);
});

test('SKU 工具保留空页及未找到语义，并将异常和损坏结果收敛为固定失败', async () => {
  let marks = 0;
  const results = [
    { ...page, items: [], total: 0 },
    { ok: false, code: 'not_found' },
    { ...page, ok: 'yes' },
    { ...page, total: -1 },
    { ...page, items: [{ ...page.items[0], unitPrice: 'private-price' }] },
    { ok: false, code: 'private-error' },
  ];
  const query = createChatProductSkusTool(
    {
      listForChat: async () => {
        assert.ok(marks > 0);
        const result = results.shift();
        if (!result) throw new Error('private-database-error');
        return result as never;
      },
    },
    () => {
      marks += 1;
    },
  );
  const outputs = await Promise.all(
    Array.from({ length: 7 }, () =>
      query.invoke({ productExternalId: 'coat-1' }),
    ),
  );
  assert.deepEqual(JSON.parse(outputs[0]!), {
    ...page,
    items: [],
    total: 0,
  });
  assert.deepEqual(JSON.parse(outputs[1]!), {
    ok: false,
    code: 'not_found',
  });
  assert.ok(
    outputs
      .slice(2)
      .every((output) => output === '{"ok":false,"code":"unavailable"}'),
  );
  assert.equal(marks, 7);
});
