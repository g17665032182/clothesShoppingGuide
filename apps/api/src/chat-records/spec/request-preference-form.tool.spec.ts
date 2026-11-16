import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRequestPreferenceFormTool,
  preferenceFormCategorySchema,
} from '../tools/request-preference-form.tool.js';

const categories = [
  'size',
  'shoe_size',
  'fit',
  'style',
  'color',
  'occasion',
  'budget',
  'avoidance',
  'purchase_preference',
] as const;

test('偏好页面请求工具只接受严格的九类类别', async () => {
  let requested: string | undefined;
  const requestTool = createRequestPreferenceFormTool((category) => {
    requested = category;
  });

  assert.equal(
    String(await requestTool.invoke({})),
    '{"ok":true,"code":"requested"}',
  );
  for (const category of categories) {
    assert.equal(
      String(await requestTool.invoke({ category })),
      `{"ok":true,"code":"requested","category":"${category}"}`,
    );
    assert.equal(requested, category);
    assert.equal(
      preferenceFormCategorySchema.safeParse(category).success,
      true,
    );
  }
  await assert.rejects(() => requestTool.invoke(null as never));
  await assert.rejects(() =>
    requestTool.invoke({ category: 'invalid' } as never),
  );
  await assert.rejects(() =>
    requestTool.invoke({ category: 'size', url: '/x' }),
  );
});

test('偏好页面请求回调异常时只返回固定不可用状态', async () => {
  const requestTool = createRequestPreferenceFormTool(() => {
    throw new Error('private failure');
  });

  assert.equal(
    String(await requestTool.invoke({ category: 'size' })),
    '{"ok":false,"code":"unavailable"}',
  );
});
