import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalEchoTool } from '../tools/local-echo.tool.js';

test('本地回显工具返回可供模型继续处理的结果', async () => {
  const localTool = createLocalEchoTool();

  assert.equal(
    await localTool.invoke({ value: 'round-trip-check' }),
    'LOCAL_TOOL_RESULT:round-trip-check',
  );
});
