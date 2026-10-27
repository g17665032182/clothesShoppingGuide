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
