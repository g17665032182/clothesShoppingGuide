import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatMessageRole } from '../dto/chat.dto.js';
import { LlmController } from '../controller/llm.controller.js';
import type { LlmService } from '../service/llm.service.js';

test('LlmController 将 DTO 映射为 Service 输入', async () => {
  const received: unknown[] = [];
  const service = {
    chat: async (input: unknown) => {
      received.push(input);
      return {
        content: 'ok',
        model: 'fake-model',
        usage: null,
      };
    },
  };
  const controller = new LlmController(service as unknown as LlmService);

  const result = await controller.chat({
    messages: [{ role: ChatMessageRole.USER, content: 'hello' }],
  });

  assert.deepEqual(result, {
    content: 'ok',
    model: 'fake-model',
    usage: null,
  });
  assert.deepEqual(received, [
    { messages: [{ role: 'user', content: 'hello' }] },
  ]);
});
