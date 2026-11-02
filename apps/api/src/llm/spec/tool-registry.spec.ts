import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfiguredTools } from '../tools/tool-registry.js';

test('工具注册入口默认不启用任何工具', () => {
  const tools = createConfiguredTools({
    get: () => undefined,
  });

  assert.deepEqual(tools, []);
});

test('工具注册入口按开关启用本地工具', () => {
  const tools = createConfiguredTools({
    get: (key: string) =>
      key === 'LLM_ENABLE_LOCAL_TEST_TOOL' ? 'true' : undefined,
  });

  assert.deepEqual(
    tools.map((current) => current.name),
    ['local_echo_tool'],
  );
});
