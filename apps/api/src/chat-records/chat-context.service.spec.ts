import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigService } from '@nestjs/config';

import { ChatContextService } from './chat-context.service.js';
import { ChatMessage, ChatRecordMessageRole } from './chat-message.entity.js';

function createService(window = 100): ChatContextService {
  return new ChatContextService(
    new ConfigService({
      LLM_CONTEXT_WINDOW_TOKENS: String(window),
      LLM_TOKEN_ENCODING: 'cl100k_base',
    }),
  );
}

function message(
  id: string,
  content: string,
  role: ChatRecordMessageRole = ChatRecordMessageRole.USER,
): ChatMessage {
  return Object.assign(new ChatMessage(), {
    id,
    conversationId: 'conversation',
    role,
    content,
  });
}

test('上下文达到阈值时生成摘要来源并保留当前消息', () => {
  const service = createService(100);
  const history = Array.from({ length: 12 }, (_, index) =>
    message(String(index), '历史消息 '.repeat(8), ChatRecordMessageRole.USER),
  );

  const plan = service.prepare({
    history,
    currentUserMessage: '当前问题',
    systemMessages: [],
  });

  assert.equal(plan.needsSummary, true);
  assert.equal(plan.summarySource.length > 0, true);
  assert.equal(plan.messages.at(-1)?.content, '当前问题');
});

test('上下文计划不会超过硬上限', () => {
  const service = createService(100);
  const history = Array.from({ length: 20 }, (_, index) =>
    message(String(index), '很长的历史消息 '.repeat(20)),
  );

  const plan = service.prepare({
    history,
    currentUserMessage: '当前问题',
    systemMessages: [],
  });

  assert.equal(service.countTokens(plan.messages) <= plan.hardLimit, true);
});

test('摘要截断按 Token 而不是字符计算', () => {
  const service = createService(100);
  const content = '你好世界 '.repeat(200);

  assert.equal(
    service.countTokens([
      { role: 'user', content: service.truncateToTokens(content, 10) },
    ]) <= 14,
    true,
  );
});
