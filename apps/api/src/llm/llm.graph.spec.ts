import assert from 'node:assert/strict';
import test from 'node:test';

import { HumanMessage } from '@langchain/core/messages';

import { createLlmGraph } from './llm.graph.js';
import { FakeChatModel } from './testing/fake-chat-model.js';

test('LangGraph 执行 START -> chatModel -> END 并标准化 token', async () => {
  const model = new FakeChatModel({
    response: 'graph response',
    usage: {
      input_tokens: 5,
      output_tokens: 6,
      total_tokens: 11,
    },
  });
  const graph = createLlmGraph(model);

  const result = await graph.invoke({
    messages: [new HumanMessage('hello')],
  });

  assert.equal(result.messages.at(-1)?.content, 'graph response');
  assert.deepEqual(result.usage, {
    inputTokens: 5,
    outputTokens: 6,
    totalTokens: 11,
  });
  assert.equal(model.calls.length, 1);
});

test('LangGraph 在供应商未返回 token 时使用 null', async () => {
  const graph = createLlmGraph(new FakeChatModel({ response: 'no usage' }));

  const result = await graph.invoke({
    messages: [new HumanMessage('hello')],
  });

  assert.equal(result.usage, undefined);
});
