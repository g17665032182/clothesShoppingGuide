import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ChatModelFactory } from './chat-model.factory.js';

const validConfig = {
  LLM_PROVIDER: 'openai-compatible',
  LLM_API_KEY: 'test-key',
  LLM_MODEL: 'test-model',
  LLM_TEMPERATURE: '0.7',
  LLM_TIMEOUT_MS: '30000',
};

test('ChatModelFactory 使用服务端配置创建 ChatOpenAI', () => {
  const factory = new ChatModelFactory(new ConfigService(validConfig));
  const model = factory.create();

  assert.equal(model.constructor.name, 'ChatOpenAI');
});

test('ChatModelFactory 配置缺失或非法时返回 503 异常', () => {
  const cases = [
    { LLM_MODEL: 'test-model' },
    { ...validConfig, LLM_PROVIDER: 'unsupported' },
    { ...validConfig, LLM_TEMPERATURE: '3' },
    { ...validConfig, LLM_TIMEOUT_MS: '0' },
  ];

  for (const config of cases) {
    assert.throws(
      () => new ChatModelFactory(new ConfigService(config)).create(),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        error.getStatus() === 503,
    );
  }
});
