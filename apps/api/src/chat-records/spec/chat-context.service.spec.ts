import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigService } from '@nestjs/config';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import { ChatContextService } from '../context/chat-context.service.js';
import type { ChatHistoryMessage } from '../history/chat-history.mapper.js';
import {
  ChatMessage,
  ChatRecordMessageRole,
} from '../entity/chat-message.entity.js';

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

  assert.equal(service.countMessages(plan.messages) <= plan.hardLimit, true);
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

test('裁剪历史时保留完整工具调用闭环', () => {
  const service = createService(100);
  const aiMessage = new AIMessage({
    content: '',
    tool_calls: [
      {
        id: 'call-weather',
        name: 'weather',
        args: { city: '上海' },
        type: 'tool_call',
      },
    ],
  });
  const history: ChatHistoryMessage[] = [
    {
      id: 'old',
      message: new HumanMessage('旧消息 '.repeat(100)),
    },
    {
      id: 'tool-request',
      message: aiMessage,
    },
    {
      id: 'tool-result',
      message: new ToolMessage({
        content: '晴，24 度',
        tool_call_id: 'call-weather',
        name: 'weather',
      }),
    },
  ];

  const plan = service.prepare({
    messageHistory: history,
    currentUserMessage: '继续说',
    systemMessages: [],
  });
  const aiIndex = plan.messages.findIndex((item) => item === aiMessage);
  const toolIndex = plan.messages.findIndex(
    (item) => item instanceof ToolMessage,
  );

  assert.equal(aiIndex >= 0, true);
  assert.equal(toolIndex > aiIndex, true);
});
