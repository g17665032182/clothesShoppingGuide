import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { tool } from '@langchain/core/tools';
import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import { createLlmGraph, normalizeUsage } from '../graph/llm.graph.js';
import { LlmService } from '../service/llm.service.js';
import type {
  LlmEventStreamResult,
  LlmStreamEvent,
} from '../stream/llm-stream.types.js';
import type { LlmTraceEvent } from '../trace/llm-trace.types.js';
import { FakeChatModel } from './fakes/fake-chat-model.js';

const input = { messages: [{ role: 'user' as const, content: '推荐服装' }] };

class ScriptedStreamModel extends FakeChatModel {
  public produced = 0;
  public completed = false;
  public closed = false;
  public gate?: Promise<void>;
  private round = 0;

  public constructor(private readonly scripts: AIMessageChunk[][]) {
    super();
  }

  public override async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
  ): AsyncGenerator<ChatGenerationChunk> {
    this.calls.push(messages);
    const chunks = this.scripts[this.round++] ?? [];
    try {
      for (const [index, message] of chunks.entries()) {
        if (index > 0 && this.gate) await this.gate;
        this.produced += 1;
        yield new ChatGenerationChunk({
          text: typeof message.content === 'string' ? message.content : '',
          message,
        });
      }
      this.completed = true;
    } finally {
      this.closed = true;
    }
  }
}

function createService(
  model: FakeChatModel,
  tools: Parameters<typeof createLlmGraph>[1] = [],
): LlmService {
  return new LlmService(
    createLlmGraph(model, tools),
    new ConfigService({ LLM_MODEL: 'fake-model' }),
  );
}

async function collect(
  stream: AsyncGenerator<LlmStreamEvent, LlmEventStreamResult>,
): Promise<{ events: LlmStreamEvent[]; result: LlmEventStreamResult }> {
  const events: LlmStreamEvent[] = [];
  while (true) {
    const next = await stream.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

test(
  '正文首段在模型完成前到达，消费者暂停时限制生产进度',
  { timeout: 2000 },
  async () => {
    const model = new ScriptedStreamModel([
      Array.from(
        { length: 50 },
        (_, index) => new AIMessageChunk(String(index)),
      ),
    ]);
    let release!: () => void;
    model.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = createService(model).streamEventsPrepared(input);
    assert.deepEqual(await stream.next(), {
      done: false,
      value: { type: 'delta', content: '0' },
    });
    assert.equal(model.completed, false);
    release();
    await setImmediate();
    await setImmediate();
    assert.ok(model.produced <= 2, `生产者提前生成了 ${model.produced} 段`);
    await stream.return(undefined as never);
    assert.equal(model.closed, true);
  },
);

test(
  '暂停消费时 Abort 和 return 均关闭上游且不会等待确认死锁',
  { timeout: 2000 },
  async () => {
    for (const cancel of ['abort', 'return']) {
      const model = new ScriptedStreamModel([
        [new AIMessageChunk('第一段'), new AIMessageChunk('第二段')],
      ]);
      const controller = new AbortController();
      const stream = createService(model).streamEventsPrepared(
        input,
        controller.signal,
      );
      await stream.next();
      if (cancel === 'abort') {
        controller.abort();
        await assert.rejects(stream.next(), { name: 'AbortError' });
      } else {
        await stream.return(undefined as never);
      }
      assert.equal(model.closed, true);
    }
  },
);

test('只公开明确正文块，不泄露 reasoning 或未知 text 块', async () => {
  const model = new ScriptedStreamModel([
    [
      new AIMessageChunk({
        content: [
          { type: 'reasoning', text: '私密推理' },
          { type: 'unknown', text: '未知数据' },
          { type: 'text', text: '正文' },
          { type: 'output_text', text: '结尾' },
        ],
      }),
    ],
  ]);
  const { events, result } = await collect(
    createService(model).streamEventsPrepared(input),
  );
  assert.deepEqual(events, [{ type: 'delta', content: '正文结尾' }]);
  assert.equal(result.content, '正文结尾');
  assert.equal(result.finalTraceSequence, null);
});

test('纯推理、未知块和空白正文不能作为成功回答结束', async () => {
  for (const chunk of [
    new AIMessageChunk({
      content: [{ type: 'reasoning', text: '私密推理' }],
    }),
    new AIMessageChunk({
      content: [{ type: 'unknown', text: '未知数据' }],
    }),
    new AIMessageChunk('   '),
  ]) {
    await assert.rejects(
      collect(
        createService(new ScriptedStreamModel([[chunk]])).streamEventsPrepared(
          input,
        ),
      ),
      BadGatewayException,
    );
  }
});

function toolModel(): ScriptedStreamModel {
  const callChunk = new AIMessageChunk({
    content: '',
    tool_call_chunks: [
      {
        type: 'tool_call_chunk',
        index: 0,
        id: 'call-1',
        name: 'echo_tool',
        args: '{"value":',
      },
    ],
  });
  // 模拟供应商只在工具调用轮次提供用量，末轮不返回 usage。
  (
    callChunk as unknown as {
      usage_metadata: {
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
      };
    }
  ).usage_metadata = { input_tokens: 2, output_tokens: 3, total_tokens: 5 };
  return new ScriptedStreamModel([
    [
      new AIMessageChunk('先查询。'),
      callChunk,
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          { type: 'tool_call_chunk', index: 0, args: '"hello"}' },
        ],
      }),
    ],
    [new AIMessageChunk('最终回答。')],
  ]);
}

test('工具参数聚合并持久化后才公开调用，正文按所有轮次聚合并使用最终 usage', async () => {
  const trace: LlmTraceEvent[] = [];
  const order: string[] = [];
  const service = createService(toolModel(), [
    tool(
      async ({ value }: { value: string }) => {
        order.push('execute');
        return `结果:${value}`;
      },
      {
        name: 'echo_tool',
        description: '测试工具',
        schema: z.object({ value: z.string() }),
      },
    ),
  ]);
  const stream = service.streamEventsPrepared(input, undefined, {
    conversationId: 'conversation-1',
    runId: 'run-1',
    writer: {
      async writeEvents(_context, events) {
        trace.push(...events);
        order.push(...events.map((event) => `persist:${event.type}`));
      },
    },
  });
  const events: LlmStreamEvent[] = [];
  let result: LlmEventStreamResult;
  while (true) {
    const next = await stream.next();
    if (next.done) {
      result = next.value;
      break;
    }
    events.push(next.value);
    order.push(`emit:${next.value.type}`);
  }
  assert.deepEqual(events, [
    { type: 'delta', content: '先查询。' },
    {
      type: 'tool-call',
      id: 'call-1',
      toolName: 'echo_tool',
      input: { value: 'hello' },
    },
    {
      type: 'tool-result',
      id: 'call-1',
      toolName: 'echo_tool',
      status: 'success',
      output: '结果:hello',
    },
    { type: 'delta', content: '最终回答。' },
  ]);
  assert.ok(
    order.indexOf('persist:tool_call') < order.indexOf('emit:tool-call'),
  );
  assert.ok(order.indexOf('emit:tool-call') < order.indexOf('execute'));
  assert.ok(
    order.indexOf('persist:tool_result') < order.indexOf('emit:tool-result'),
  );
  assert.equal(result.content, '先查询。最终回答。');
  assert.equal(result.usage, null);
  assert.equal(result.finalTraceSequence, 4);
  assert.deepEqual(
    trace.map((event) => event.sequence),
    [0, 1, 2, 3, 4],
  );
});

test('工具失败公开失败状态并终止本轮，不再次请求模型', async () => {
  const model = toolModel();
  const service = createService(model, [
    tool(
      async () => {
        throw new Error('供应商内部失败');
      },
      {
        name: 'echo_tool',
        description: '测试失败工具',
        schema: z.object({ value: z.string() }),
      },
    ),
  ]);
  const stream = service.streamEventsPrepared(input);
  const events: LlmStreamEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of stream) events.push(event);
  }, BadGatewayException);
  assert.equal(model.calls.length, 1);
  assert.equal(events.at(-1)?.type, 'tool-result');
  assert.equal(
    (events.at(-1) as Extract<LlmStreamEvent, { type: 'tool-result' }>).status,
    'error',
  );
});

test('token 使用量只接受非负安全整数', () => {
  const message = new AIMessageChunk({
    content: '正文',
    response_metadata: {
      tokenUsage: { input_tokens: -1, output_tokens: 1.5, total_tokens: 3 },
    },
  });
  assert.deepEqual(normalizeUsage(message), {
    inputTokens: null,
    outputTokens: null,
    totalTokens: 3,
  });
});
