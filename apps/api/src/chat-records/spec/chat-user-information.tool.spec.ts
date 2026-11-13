import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatUserInformationTool } from '../tools/chat-user-information.tool.js';

test('试穿查询在 lookup 首次执行前标记，并在失败及并行调用中保留标记', async () => {
  let marked = false;
  let calls = 0;
  const query = createChatUserInformationTool(
    {
      lookup: async () => {
        assert.equal(marked, true);
        calls += 1;
        throw new Error('controlled failure');
      },
    } as never,
    () => {
      marked = true;
    },
  );
  const results = await Promise.allSettled([
    query.invoke({ sections: ['try_on_tasks'] }),
    query.invoke({ sections: ['try_on_tasks'] }),
  ]);
  assert.equal(calls, 2);
  assert.equal(marked, true);
  assert.ok(results.every((result) => result.status === 'rejected'));
});

test('原默认三类和非法试穿参数不触发运行标记，合法空结果仍触发', async () => {
  let marks = 0;
  const inputs: unknown[] = [];
  const query = createChatUserInformationTool(
    {
      lookup: async (input: unknown) => {
        inputs.push(input);
        return { ok: true, sections: {}, errors: [] };
      },
    } as never,
    () => {
      marks += 1;
    },
  );
  await query.invoke({});
  assert.deepEqual(inputs, [
    { sections: ['addresses', 'orders', 'photos'], page: 1 },
  ]);
  assert.equal(marks, 0);
  for (const invalid of [
    { sections: ['try_on_tasks'], page: '1' },
    { sections: ['photos'], tryOnStatus: 'failed' },
    { sections: ['try_on_tasks'], userId: 'another' },
  ]) {
    await assert.rejects(() => query.invoke(invalid as never));
  }
  assert.equal(inputs.length, 1);
  assert.equal(marks, 0);
  await query.invoke({ sections: ['try_on_tasks'], tryOnStatus: 'failed' });
  assert.equal(marks, 1);
});
