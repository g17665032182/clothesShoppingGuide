import assert from 'node:assert/strict';
import test from 'node:test';

import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import {
  mapLegacyMessagesToLangChain,
  mapTraceEventsToMessages,
} from '../history/chat-history.mapper.js';

test('trace 事件可以恢复用户、带工具调用的模型和工具结果消息', () => {
  const messages = mapTraceEventsToMessages([
    {
      eventType: 'input',
      sequence: 1,
      messageId: 'human-1',
      content: '查一下天气',
    },
    {
      eventType: 'model_response',
      sequence: 2,
      messageId: 'ai-1',
      content: '',
      payload: {
        toolCalls: [{ id: 'call-1', name: 'weather', args: { city: '上海' } }],
      },
    },
    {
      eventType: 'tool_call',
      sequence: 3,
      messageId: 'ai-1',
      toolCallId: 'call-1',
      toolName: 'weather',
      payload: { args: { city: '上海' } },
    },
    {
      eventType: 'tool_result',
      sequence: 4,
      messageId: 'tool-1',
      toolCallId: 'call-1',
      toolName: 'weather',
      content: '{"temperature":24}',
      status: 'success',
    },
  ]);

  assert.equal(messages.length, 3);
  assert.equal(messages[0]?.message instanceof HumanMessage, true);
  assert.equal(messages[1]?.message instanceof AIMessage, true);
  assert.deepEqual((messages[1]?.message as AIMessage).tool_calls, [
    { id: 'call-1', name: 'weather', args: { city: '上海' } },
  ]);
  assert.equal(messages[2]?.message instanceof ToolMessage, true);
  assert.equal((messages[2]?.message as ToolMessage).tool_call_id, 'call-1');
});

test('旧聊天消息映射为普通 LangChain 消息', () => {
  const messages = mapLegacyMessagesToLangChain([
    { id: 'user-1', role: 'user', content: '你好' },
    { id: 'assistant-1', role: 'assistant', content: '你好，有什么可以帮你？' },
  ]);

  assert.equal(messages[0]?.message instanceof HumanMessage, true);
  assert.equal(messages[1]?.message instanceof AIMessage, true);
  assert.equal(messages[0]?.message.id, 'user-1');
});

test('公开展示元数据不进入下一轮模型历史且不替换 LangChain 消息 ID', () => {
  const base = {
    eventType: 'model_response' as const,
    sequence: 2,
    messageId: 'langchain-message',
    content: '已找到服装',
    payload: {
      toolCalls: [{ id: 'call-1', name: 'lookup', args: { query: 'coat' } }],
    },
  };
  const withoutDisplay = mapTraceEventsToMessages([base]);
  const withDisplay = mapTraceEventsToMessages([
    {
      ...base,
      payload: {
        ...base.payload,
        publicDisplay: {
          assistantMessageId: 'public-message-uuid',
          activities: [{ type: 'reasoning', summary: 'display-only-summary' }],
          sources: [{ url: 'https://example.com/display-only-source' }],
          context: { usedTokens: 999 },
        },
      },
    },
  ]);
  assert.deepEqual(withDisplay, withoutDisplay);
  assert.equal(withDisplay[0]?.message.id, 'langchain-message');
  assert.equal(
    JSON.stringify(withDisplay).includes('display-only-summary'),
    false,
  );
});
