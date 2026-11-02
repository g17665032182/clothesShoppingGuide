import assert from 'node:assert/strict';
import test from 'node:test';

import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import {
  AIMessageChunk,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { z } from 'zod';

import { createLlmGraph } from '../graph/llm.graph.js';
import { FakeChatModel } from './fakes/fake-chat-model.js';
import type { LlmTraceEvent } from '../trace/llm-trace.types.js';

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
  const model = new FakeChatModel({
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
  });
  const graph = createLlmGraph(model, [echoTool]);

  const result = await graph.invoke({
    messages: [new HumanMessage('请调用工具')],
  });

  assert.deepEqual(calls, ['hello']);
  assert.equal(result.messages.at(-1)?.content, 'final response');
  assert.equal(
    result.messages.filter((message) => message.type === 'tool').length,
    1,
  );
  assert.equal(model.calls[1]?.at(-1)?.type, 'tool');
  assert.equal(model.calls[1]?.at(-1)?.content, 'tool result: hello');
});

test('LangGraph 节点按顺序记录输入、模型、工具调用和工具结果', async () => {
  const events: LlmTraceEvent[] = [];
  const writer = {
    async writeEvents(
      _context: { conversationId: string; runId: string },
      values: LlmTraceEvent[],
    ) {
      events.push(...values);
    },
  };
  const echoTool = tool(async ({ value }) => `tool result: ${value}`, {
    name: 'echo_tool',
    description: '回显输入值。',
    schema: z.object({ value: z.string() }),
  });
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
        { response: 'done' },
      ],
    }),
    [echoTool],
  );

  await graph.invoke(
    { messages: [new HumanMessage('请调用工具')] },
    {
      context: {
        conversationId: 'conversation-1',
        runId: 'run-1',
        writer,
        model: 'fake-model',
      } as never,
    },
  );

  assert.deepEqual(
    events.map((event) => `${event.sequence}:${event.type}`),
    [
      '0:input',
      '1:model_response',
      '2:tool_call',
      '3:tool_result',
      '4:model_response',
    ],
  );
  assert.equal(events[2]?.type, 'tool_call');
  assert.equal(events[3]?.type, 'tool_result');
  assert.equal(events[3]?.content, 'tool result: hello');
});

test('流式工具参数完整聚合后才执行，结果持久化后继续模型流', async () => {
  class StreamingToolModel extends FakeChatModel {
    private streamCount = 0;

    public override async *_streamResponseChunks(
      _messages: BaseMessage[],
      _options: this['ParsedCallOptions'],
      _runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
      this.streamCount += 1;
      if (this.streamCount === 1) {
        yield new ChatGenerationChunk({
          text: '',
          message: new AIMessageChunk({
            content: '',
            tool_call_chunks: [
              {
                type: 'tool_call_chunk',
                id: 'call-stream-1',
                name: 'echo_tool',
                args: '{"value":',
                index: 0,
              },
            ],
          }),
        });
        yield new ChatGenerationChunk({
          text: '',
          message: new AIMessageChunk({
            content: '',
            tool_call_chunks: [
              {
                type: 'tool_call_chunk',
                args: '"hello"}',
                index: 0,
              },
            ],
          }),
        });
        return;
      }
      yield new ChatGenerationChunk({
        text: '最终回答',
        message: new AIMessageChunk('最终回答'),
      });
    }
  }

  const eventOrder: string[] = [];
  const echoTool = tool(
    async ({ value }) => {
      eventOrder.push(`tool:${value}`);
      return `结果:${value}`;
    },
    {
      name: 'echo_tool',
      description: '回显输入值。',
      schema: z.object({ value: z.string() }),
    },
  );
  const graph = createLlmGraph(new StreamingToolModel(), [echoTool]);
  const writer = {
    async writeEvents(
      _context: { conversationId: string; runId: string },
      events: LlmTraceEvent[],
    ) {
      eventOrder.push(...events.map((event) => event.type));
    },
  };
  const states = await graph.stream(
    { messages: [new HumanMessage('请调用工具')] },
    {
      streamMode: 'values',
      context: {
        conversationId: 'conversation-1',
        runId: 'run-1',
        writer,
        model: 'fake-model',
        streaming: true,
      } as never,
    },
  );
  let finalState;
  for await (const state of states) {
    finalState = state;
  }

  assert.equal(finalState?.messages.at(-1)?.content, '最终回答');
  assert.deepEqual(eventOrder, [
    'input',
    'model_response',
    'tool_call',
    'tool:hello',
    'tool_result',
    'model_response',
  ]);
});
