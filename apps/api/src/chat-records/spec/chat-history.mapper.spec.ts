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

test('天气查询调用及结果从后续模型历史隐藏', () => {
  const messages = mapTraceEventsToMessages([
    {
      eventType: 'model_response',
      sequence: 1,
      messageId: 'model',
      content: '',
      payload: {
        toolCalls: [
          {
            id: 'weather-call',
            name: 'get_weather_forecast',
            args: { city: '上海' },
          },
          { id: 'ordinary-call', name: 'ordinary_tool', args: { q: 'coat' } },
        ],
      },
    },
    {
      eventType: 'tool_call',
      sequence: 2,
      messageId: 'model',
      toolCallId: 'weather-call',
      toolName: 'get_weather_forecast',
      payload: { args: { city: '上海' } },
    },
    {
      eventType: 'tool_result',
      sequence: 3,
      messageId: 'weather-result',
      toolCallId: 'weather-call',
      toolName: 'get_weather_forecast',
      content: '{"ok":true,"location":"上海"}',
      status: 'success',
    },
  ]);

  assert.equal(messages.length, 1);
  assert.deepEqual((messages[0]?.message as AIMessage).tool_calls, [
    { id: 'ordinary-call', name: 'ordinary_tool', args: { q: 'coat' } },
  ]);
  assert.equal(JSON.stringify(messages).includes('天气'), false);
  assert.equal(JSON.stringify(messages).includes('weather-call'), false);
});

test('售后查询和创建工具的调用及结果从后续模型历史成对隐藏', () => {
  const names = [
    'list_my_return_refund_orders',
    'get_my_return_refund_items',
    'create_return_refund_application',
  ];
  const messages = mapTraceEventsToMessages([
    {
      eventType: 'model_response',
      sequence: 1,
      messageId: 'model',
      content: '',
      payload: {
        invalid_tool_calls: [
          {
            id: 'refund-invalid',
            name: 'create_return_refund_application',
            args: '{"reason":"private-reason"}',
          },
        ],
        toolCalls: [
          ...names.map((name, index) => ({
            id: `refund-call-${index}`,
            name,
            args: {
              orderId: 'private-order-id',
              reason: 'private-reason',
            },
          })),
          { id: 'ordinary-call', name: 'ordinary_tool', args: { q: 'coat' } },
        ],
      },
    },
    ...names.flatMap((name, index) => [
      {
        eventType: 'tool_call' as const,
        sequence: index + 2,
        messageId: 'model',
        toolCallId: `refund-call-${index}`,
        toolName: name,
        payload: { args: { reason: 'private-reason' } },
      },
      {
        eventType: 'tool_result' as const,
        sequence: index + 5,
        messageId: `result-${index}`,
        toolCallId: `refund-call-${index}`,
        toolName: name,
        content: '{"ok":true,"reason":"private-reason"}',
        status: 'success' as const,
      },
    ]),
    {
      eventType: 'tool_result',
      sequence: 10,
      messageId: 'orphan-result',
      toolCallId: 'orphan-refund-call',
      toolName: 'create_return_refund_application',
      content: '{"ok":true,"reason":"private-reason"}',
      status: 'success',
    },
  ]);

  assert.equal(messages.length, 1);
  assert.deepEqual((messages[0]?.message as AIMessage).tool_calls, [
    { id: 'ordinary-call', name: 'ordinary_tool', args: { q: 'coat' } },
  ]);
  const serialized = JSON.stringify(messages);
  assert.equal(serialized.includes('private-reason'), false);
  assert.equal(serialized.includes('private-order-id'), false);
  assert.equal(serialized.includes('refund-call'), false);
  assert.equal(serialized.includes('orphan-refund-call'), false);
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

test('购买调用及结果从历史移除，同批普通商品工具闭环保留', () => {
  const messages = mapTraceEventsToMessages([
    {
      eventType: 'model_response',
      sequence: 1,
      messageId: 'mixed',
      content: '',
      payload: {
        toolCalls: [
          {
            id: 'purchase-call',
            name: 'update_purchase_draft',
            args: { draftId: 'draft', recipient: { address: 'private' } },
          },
          {
            id: 'catalog-call',
            name: 'search_local_clothing_products',
            args: { keyword: '大衣' },
          },
        ],
      },
    },
    {
      eventType: 'tool_call',
      sequence: 2,
      messageId: 'mixed',
      toolCallId: 'purchase-call',
      toolName: 'update_purchase_draft',
      payload: { args: { recipient: { address: 'private' } } },
    },
    {
      eventType: 'tool_call',
      sequence: 3,
      messageId: 'mixed',
      toolCallId: 'catalog-call',
      toolName: 'search_local_clothing_products',
      payload: { args: { keyword: '大衣' } },
    },
    {
      eventType: 'tool_result',
      sequence: 4,
      messageId: 'purchase-result',
      toolCallId: 'purchase-call',
      toolName: 'update_purchase_draft',
      content: '{"recipient":{"address":"private"}}',
      status: 'success',
    },
    {
      eventType: 'tool_result',
      sequence: 5,
      messageId: 'catalog-result',
      toolCallId: 'catalog-call',
      toolName: 'search_local_clothing_products',
      content: '{"items":[]}',
      status: 'success',
    },
  ]);

  assert.equal(messages.length, 2);
  const aiMessage = messages[0]?.message as AIMessage;
  assert.deepEqual(
    aiMessage.tool_calls?.map((call) => call.id),
    ['catalog-call'],
  );
  assert.equal(
    (messages[1]?.message as ToolMessage).tool_call_id,
    'catalog-call',
  );
  assert.equal(JSON.stringify(messages).includes('private'), false);
});

test('用户信息查询及旧地址选择调用和结果从模型历史成对隐藏', () => {
  const messages = mapTraceEventsToMessages([
    {
      eventType: 'model_response',
      sequence: 1,
      messageId: 'private-tools',
      content: '',
      payload: {
        toolCalls: [
          {
            id: 'information-call',
            name: 'get_my_information',
            args: { sections: ['addresses'] },
          },
          {
            id: 'legacy-address-call',
            name: 'select_my_shipping_address',
            args: { addressId: 'private-address-id' },
          },
          {
            id: 'weather-call',
            name: 'weather',
            args: { city: '上海' },
          },
        ],
      },
    },
    {
      eventType: 'tool_result',
      sequence: 2,
      messageId: 'information-result',
      toolCallId: 'information-call',
      toolName: 'get_my_information',
      content: '{"sections":{"addresses":{"items":[{"addressId":"private"}]}}}',
      status: 'success',
    },
    {
      eventType: 'tool_result',
      sequence: 3,
      messageId: 'legacy-address-result',
      toolCallId: 'legacy-address-call',
      toolName: 'select_my_shipping_address',
      content: '{"ok":true}',
      status: 'success',
    },
    {
      eventType: 'tool_result',
      sequence: 4,
      messageId: 'weather-result',
      toolCallId: 'weather-call',
      toolName: 'weather',
      content: '{"temperature":24}',
      status: 'success',
    },
  ]);

  assert.equal(messages.length, 2);
  const calls = (messages[0]?.message as AIMessage).tool_calls ?? [];
  assert.deepEqual(
    calls.map((call) => call.name),
    ['weather'],
  );
  assert.equal(
    (messages[1]?.message as ToolMessage).tool_call_id,
    'weather-call',
  );
  assert.equal(JSON.stringify(messages).includes('private-address-id'), false);
  assert.equal(JSON.stringify(messages).includes('addressId'), false);
});

test('试穿任务查询在混合工具历史中成对隐藏，最终正文继续保留', () => {
  const messages = mapTraceEventsToMessages([
    {
      eventType: 'model_response',
      sequence: 1,
      messageId: 'model-invocation',
      content: '',
      payload: {
        toolCalls: [
          {
            id: 'try-on-query',
            name: 'get_my_information',
            args: { sections: ['try_on_tasks'] },
          },
          {
            id: 'catalog',
            name: 'search_local_clothing_products',
            args: { category: 'tops' },
          },
        ],
      },
    },
    {
      eventType: 'tool_result',
      sequence: 2,
      messageId: 'try-on-result',
      toolCallId: 'try-on-query',
      toolName: 'get_my_information',
      content:
        '{"sections":{"try_on_tasks":{"items":[{"taskId":"hidden-task"}]}}}',
      status: 'success',
    },
    {
      eventType: 'tool_result',
      sequence: 3,
      messageId: 'catalog-result',
      toolCallId: 'catalog',
      toolName: 'search_local_clothing_products',
      content: '{"items":[]}',
      status: 'success',
    },
    {
      eventType: 'model_response',
      sequence: 4,
      messageId: 'final',
      content: '最近任务已完成，请到我的试穿查看。',
    },
  ]);
  assert.equal(messages.length, 3);
  assert.deepEqual(
    (messages[0]?.message as AIMessage).tool_calls?.map((call) => call.id),
    ['catalog'],
  );
  assert.equal((messages[1]?.message as ToolMessage).tool_call_id, 'catalog');
  assert.equal(
    messages[2]?.message.content,
    '最近任务已完成，请到我的试穿查看。',
  );
  assert.equal(JSON.stringify(messages).includes('hidden-task'), false);
});

test('规格和偏好查询在两种嵌套格式中成对隐藏，普通工具及最终正文保留', () => {
  for (const key of ['toolCalls', 'tool_calls']) {
    const messages = mapTraceEventsToMessages([
      {
        eventType: 'model_response',
        sequence: 0,
        messageId: 'mixed-detail-query',
        content: '',
        payload: {
          [key]: [
            {
              id: 'sku-call',
              name: 'get_product_skus',
              args: { productExternalId: 'private-product' },
            },
            {
              id: 'preference-call',
              name: 'get_my_preferences',
              args: { category: 'style' },
            },
            {
              id: 'catalog-call',
              name: 'search_local_clothing_products',
              args: { keyword: '大衣' },
            },
          ],
        },
      },
      {
        eventType: 'tool_result',
        sequence: 1,
        messageId: 'sku-result',
        toolCallId: 'sku-call',
        content: '{"items":[{"size":"private-size"}]}',
        status: 'success',
      },
      {
        eventType: 'tool_result',
        sequence: 2,
        messageId: 'preference-result',
        toolCallId: 'preference-call',
        content: '{"items":[{"value":"private-preference"}]}',
        status: 'success',
      },
      {
        eventType: 'tool_result',
        sequence: 3,
        messageId: 'catalog-result',
        toolCallId: 'catalog-call',
        toolName: 'search_local_clothing_products',
        content: '{"items":[]}',
        status: 'success',
      },
      {
        eventType: 'model_response',
        sequence: 4,
        messageId: 'final',
        content: '已查到可选尺码和你的偏好。',
      },
    ]);
    assert.equal(messages.length, 3);
    assert.deepEqual(
      (messages[0]?.message as AIMessage).tool_calls?.map((call) => call.id),
      ['catalog-call'],
    );
    assert.equal(
      (messages[1]?.message as ToolMessage).tool_call_id,
      'catalog-call',
    );
    assert.equal(messages[2]?.message.content, '已查到可选尺码和你的偏好。');
    assert.equal(JSON.stringify(messages).includes('private'), false);
  }
});

test('独立规格与偏好调用及无调用的命名结果仍被隐藏，旧聊天正文兼容', () => {
  const finalText = '已完成查询。';
  const messages = mapTraceEventsToMessages([
    {
      eventType: 'model_response',
      sequence: 0,
      messageId: 'standalone',
      content: '',
    },
    ...['get_product_skus', 'get_my_preferences'].flatMap((toolName, index) => [
      {
        eventType: 'tool_call' as const,
        sequence: 1 + index * 2,
        toolCallId: `detail-${index}`,
        toolName,
        payload: { private: 'private-arguments' },
      },
      {
        eventType: 'tool_result' as const,
        sequence: 2 + index * 2,
        toolCallId: `detail-${index}`,
        content: 'private-result',
      },
    ]),
    {
      eventType: 'tool_result',
      sequence: 5,
      toolCallId: 'orphaned',
      toolName: 'get_my_preferences',
      content: 'private-orphaned-result',
    },
    {
      eventType: 'model_response',
      sequence: 6,
      messageId: 'final',
      content: finalText,
    },
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.message.content, finalText);
  const legacy = mapLegacyMessagesToLangChain([
    { id: 'legacy-final', role: 'assistant', content: finalText },
  ]);
  assert.equal(legacy[0]?.message.content, finalText);
});

test('非法调用与并存兼容调用键中的隐藏 ID 仍阻止无工具名结果回流', () => {
  const messages = mapTraceEventsToMessages([
    {
      eventType: 'model_response',
      sequence: 0,
      content: '',
      payload: {
        toolCalls: [],
        tool_calls: [
          {
            id: 'sku-call',
            name: 'get_product_skus',
            args: { productExternalId: 'private-product' },
          },
        ],
        invalid_tool_calls: [
          {
            id: 'invalid-preference-call',
            name: 'get_my_preferences',
            args: 'private-invalid-json',
          },
        ],
      },
    },
    {
      eventType: 'tool_result',
      sequence: 1,
      toolCallId: 'sku-call',
      content: 'private-sku-result',
    },
    {
      eventType: 'tool_result',
      sequence: 2,
      toolCallId: 'invalid-preference-call',
      content: 'private-preference-result',
    },
  ]);
  assert.deepEqual(messages, []);
});

test('偏好表单调用和结果从模型历史成对隐藏，包括非法调用与孤立结果', () => {
  const messages = mapTraceEventsToMessages([
    {
      eventType: 'model_response',
      sequence: 0,
      messageId: 'mixed',
      content: '',
      payload: {
        toolCalls: [
          {
            id: 'preference-form-call',
            name: 'request_preference_form',
            args: { category: 'size' },
          },
          {
            id: 'ordinary-call',
            name: 'search_local_clothing_products',
            args: { keyword: 'coat' },
          },
        ],
        invalid_tool_calls: [
          {
            id: 'invalid-preference-form-call',
            name: 'request_preference_form',
            args: 'private-arguments',
          },
        ],
      },
    },
    {
      eventType: 'tool_call',
      sequence: 1,
      messageId: 'mixed',
      toolCallId: 'preference-form-call',
      toolName: 'request_preference_form',
      payload: { args: { category: 'size' } },
    },
    {
      eventType: 'tool_result',
      sequence: 2,
      toolCallId: 'preference-form-call',
      toolName: 'request_preference_form',
      content: 'private-preference-result',
    },
    {
      eventType: 'tool_result',
      sequence: 3,
      toolCallId: 'invalid-preference-form-call',
      content: 'private-invalid-result',
    },
    {
      eventType: 'tool_result',
      sequence: 4,
      toolCallId: 'orphan-preference-form-call',
      toolName: 'request_preference_form',
      content: 'private-orphan-result',
    },
    {
      eventType: 'tool_call',
      sequence: 5,
      messageId: 'mixed',
      toolCallId: 'ordinary-call',
      toolName: 'search_local_clothing_products',
      payload: { args: { keyword: 'coat' } },
    },
    {
      eventType: 'tool_result',
      sequence: 6,
      toolCallId: 'ordinary-call',
      toolName: 'search_local_clothing_products',
      content: '{"items":[]}',
    },
  ]);

  assert.equal(messages.length, 2);
  assert.deepEqual(
    (messages[0]?.message as AIMessage).tool_calls?.map((call) => call.id),
    ['ordinary-call'],
  );
  assert.equal(
    (messages[1]?.message as ToolMessage).tool_call_id,
    'ordinary-call',
  );
  assert.equal(JSON.stringify(messages).includes('private'), false);
});
