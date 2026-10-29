import assert from 'node:assert/strict';
import test from 'node:test';

import { HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

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

test('LangGraph 使用 ToolNode 执行工具后回到模型节点', async () => {
  const calls: string[] = [];
  const echoTool = tool(
    async ({ value }) => {
      calls.push(value);
      return `tool result: ${value}`;
    },
    {
      name: 'echo_tool',
      description: '回显输入值，用于测试工具调用链路。',
      schema: z.object({ value: z.string() }),
    },
  );
  const graph = createLlmGraph(
    new FakeChatModel({
      responses: [
        {
          response: '',
          toolCalls: [
            {
              name: 'echo_tool',
              args: { value: 'hello' },
              id: 'call-1',
              type: 'tool_call',
            },
          ],
        },
        { response: 'final response' },
      ],
    }),
    [echoTool],
  );

  const result = await graph.invoke({
    messages: [new HumanMessage('请调用工具')],
  });

  assert.deepEqual(calls, ['hello']);
  assert.equal(result.messages.at(-1)?.content, 'final response');
  assert.equal(
    result.messages.filter((message) => message.type === 'tool').length,
    1,
  );
});
