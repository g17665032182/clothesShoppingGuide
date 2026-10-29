import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createLlmGraph } from './llm.graph.js';
import { LlmService } from './llm.service.js';
import { FakeChatModel } from './testing/fake-chat-model.js';

function serviceWithModel(
  model: FakeChatModel,
  config: Record<string, unknown> = { LLM_MODEL: 'fake-model' },
): LlmService {
  return new LlmService(createLlmGraph(model), new ConfigService(config));
}

test('LlmService 转换消息并返回统一响应', async () => {
  const model = new FakeChatModel({
    response: 'service response',
    usage: {
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
    },
  });
  const service = serviceWithModel(model);

  const result = await service.chat({
    messages: [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'previous answer' },
    ],
  });

  assert.deepEqual(result, {
    content: 'service response',
    model: 'fake-model',
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    },
  });
  assert.deepEqual(
    model.calls[0]?.map((message) => message.type),
    ['system', 'human', 'ai'],
  );
});

test('LlmService 在缺少模型配置时返回 503', async () => {
  const service = serviceWithModel(new FakeChatModel(), { LLM_MODEL: '' });

  await assert.rejects(
    service.chat({ messages: [{ role: 'user', content: 'hello' }] }),
    (error: unknown) =>
      error instanceof ServiceUnavailableException && error.getStatus() === 503,
  );
});

test('LlmService 将超时映射为 504 且不泄露上游错误详情', async () => {
  const service = serviceWithModel(
    new FakeChatModel({
      error: Object.assign(new Error('secret API key sk-test timeout'), {
        name: 'TimeoutError',
      }),
    }),
  );

  await assert.rejects(
    service.chat({ messages: [{ role: 'user', content: 'hello' }] }),
    (error: unknown) =>
      error instanceof GatewayTimeoutException &&
      error.getStatus() === 504 &&
      !JSON.stringify(error.getResponse()).includes('sk-test'),
  );
});

test('LlmService 将普通供应商异常映射为 502', async () => {
  const service = serviceWithModel(
    new FakeChatModel({
      error: new Error('secret API key sk-test provider failure'),
    }),
  );

  await assert.rejects(
    service.chat({ messages: [{ role: 'user', content: 'hello' }] }),
    (error: unknown) =>
      error instanceof BadGatewayException &&
      error.getStatus() === 502 &&
      !JSON.stringify(error.getResponse()).includes('sk-test'),
  );
});

test('LlmService 在供应商未返回 token 时返回 null usage', async () => {
  const service = serviceWithModel(
    new FakeChatModel({ response: 'without usage' }),
  );

  const result = await service.chat({
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(result.usage, null);
});

test('LlmService 按顺序产出流式 chunk，并在结束时聚合完整结果', async () => {
  const model = new FakeChatModel({
    chunks: ['春日', '通勤', '穿搭'],
    usage: {
      input_tokens: 3,
      output_tokens: 4,
      total_tokens: 7,
    },
  });
  const service = serviceWithModel(model);
  const chunks: string[] = [];
  const stream = service.stream({
    messages: [{ role: 'user', content: '推荐春日通勤穿搭' }],
  });

  let result: IteratorResult<
    string,
    ReturnType<typeof service.stream> extends AsyncGenerator<string, infer T>
      ? T
      : never
  >;
  while (true) {
    const next = await stream.next();
    if (next.done) {
      result = next;
      break;
    }
    chunks.push(next.value);
  }

  assert.deepEqual(chunks, ['春日通勤穿搭']);
  assert.deepEqual(result.value, {
    content: '春日通勤穿搭',
    model: 'fake-model',
    usage: {
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    },
  });
});

test('LlmService 将流式供应商异常映射为 502', async () => {
  const service = serviceWithModel(
    new FakeChatModel({
      chunks: ['部分内容'],
      streamError: new Error('secret API key sk-test stream failure'),
    }),
  );
  const stream = service.stream({
    messages: [{ role: 'user', content: 'hello' }],
  });

  await assert.rejects(
    (async () => {
      for await (const _chunk of stream) {
        // 消费流以触发供应商异常。
      }
    })(),
    (error: unknown) =>
      error instanceof BadGatewayException &&
      error.getStatus() === 502 &&
      !JSON.stringify(error.getResponse()).includes('sk-test'),
  );
});
