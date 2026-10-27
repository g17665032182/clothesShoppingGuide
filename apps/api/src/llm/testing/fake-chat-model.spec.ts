import assert from 'node:assert/strict';
import test from 'node:test';

import { HumanMessage } from '@langchain/core/messages';

import { FakeChatModel } from './fake-chat-model.js';

test('FakeChatModel 返回固定 AIMessage 并记录输入消息', async () => {
  const model = new FakeChatModel({
    response: '本地测试响应',
    usage: {
      input_tokens: 3,
      output_tokens: 4,
      total_tokens: 7,
    },
  });

  const response = await model.invoke([new HumanMessage('你好')]);

  assert.equal(response.content, '本地测试响应');
  assert.deepEqual(response.usage_metadata, {
    input_tokens: 3,
    output_tokens: 4,
    total_tokens: 7,
  });
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0]?.[0]?.content, '你好');
});

test('FakeChatModel 可以模拟上游异常', async () => {
  const error = new Error('simulated provider failure');
  const model = new FakeChatModel({ error });

  await assert.rejects(model.invoke([new HumanMessage('你好')]), error);
});
