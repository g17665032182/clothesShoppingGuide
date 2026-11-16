import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatPreferencesTool } from '../tools/chat-preferences.tool.js';

const page = {
  ok: true,
  items: [
    {
      category: 'style',
      valueType: 'multi',
      value: { items: ['简约'] },
      isPrimary: true,
      updatedAt: '2026-11-16T01:00:00.000Z',
    },
  ],
  page: 1,
  pageSize: 5,
  total: 1,
  hasNext: false,
};

test('偏好工具固定服务端身份，在读取前标记并再次投影全部返回字段', async () => {
  let marked = false;
  const inputs: unknown[] = [];
  const result = {
    ...page,
    userId: 'private-user-id',
    items: [{ ...page.items[0], preferenceId: 'private-preference-id' }],
  };
  const original = structuredClone(result);
  const query = createChatPreferencesTool(
    {
      listForChat: async (userId, input) => {
        assert.equal(marked, true);
        inputs.push({ userId, input });
        return result as never;
      },
    },
    'trusted-user',
    () => {
      marked = true;
    },
  );
  assert.deepEqual(JSON.parse(await query.invoke({ category: 'style' })), page);
  assert.deepEqual(inputs, [
    { userId: 'trusted-user', input: { category: 'style', page: 1 } },
  ]);
  assert.deepEqual(result, original);
  assert.equal(query.name, 'get_my_preferences');
});

test('偏好工具不接受身份覆盖、非法类别、动作或页码强制转换', async () => {
  let calls = 0;
  let marks = 0;
  const query = createChatPreferencesTool(
    {
      listForChat: async () => {
        calls += 1;
        return { ok: false, code: 'preferences_disabled' };
      },
    },
    'trusted-user',
    () => {
      marks += 1;
    },
  );
  for (const input of [
    { userId: 'other-user' },
    { category: 'health' },
    { action: 'update' },
    { page: '1' },
    { page: 0 },
    { page: 11 },
    { page: 1.5 },
  ]) {
    await assert.rejects(() => query.invoke(input as never));
  }
  assert.equal(calls, 0);
  assert.equal(marks, 0);
});

test('偏好工具区分空页与关闭，并拒绝嵌套敏感值、错配类型及损坏分页', async () => {
  let marks = 0;
  const results = [
    { ...page, items: [], total: 0 },
    { ok: false, code: 'preferences_disabled' },
    { ...page, ok: 'yes' },
    { ...page, items: [{ ...page.items[0], valueType: 'single' }] },
    {
      ...page,
      items: [
        { ...page.items[0], value: { items: ['简约'], userId: 'private-id' } },
      ],
    },
    {
      ...page,
      items: [
        {
          ...page.items[0],
          value: { items: ['身份证号码110101199001011234'] },
        },
      ],
    },
    { ...page, hasNext: true },
    { ok: false, code: 'private-error' },
  ];
  const query = createChatPreferencesTool(
    {
      listForChat: async () => {
        assert.ok(marks > 0);
        const result = results.shift();
        if (!result) throw new Error('private-database-error');
        return result as never;
      },
    },
    'trusted-user',
    () => {
      marks += 1;
    },
  );
  const outputs = await Promise.all(
    Array.from({ length: 9 }, () => query.invoke({})),
  );
  assert.deepEqual(JSON.parse(outputs[0]!), {
    ...page,
    items: [],
    total: 0,
  });
  assert.deepEqual(JSON.parse(outputs[1]!), {
    ok: false,
    code: 'preferences_disabled',
  });
  assert.ok(
    outputs
      .slice(2)
      .every((output) => output === '{"ok":false,"code":"unavailable"}'),
  );
  assert.equal(marks, 9);
});
