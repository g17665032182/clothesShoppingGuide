import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChatTraceEvent,
  ChatTraceEventStatus,
} from '../entity/chat-trace-event.entity.js';
import { ChatTraceWriterService } from '../trace/chat-trace-writer.service.js';

type TraceRow = ChatTraceEvent;

function createWriter() {
  const rows: TraceRow[] = [];
  let pending: TraceRow[] = [];
  let flushCount = 0;
  const manager = {
    async findOne(
      _entity: typeof ChatTraceEvent,
      where: Partial<ChatTraceEvent>,
    ) {
      return (
        [...rows, ...pending].find((row) =>
          Object.entries(where).every(
            ([key, value]) => row[key as keyof ChatTraceEvent] === value,
          ),
        ) ?? null
      );
    },
    persist(value: TraceRow) {
      pending.push(value);
    },
    async flush() {
      flushCount += 1;
      rows.push(...pending);
      pending = [];
    },
    async transactional<T>(callback: (transaction: never) => Promise<T>) {
      const existingRows = [...rows];
      const result = await callback(manager as never);
      if (pending.length > 0) {
        rows.splice(0, rows.length, ...existingRows);
      }
      return result;
    },
  };
  const repository = { getEntityManager: () => manager };
  const writer = new ChatTraceWriterService(repository as never);
  return {
    writer,
    rows,
    get flushCount() {
      return flushCount;
    },
  };
}

const context = {
  conversationId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
};

test('writer 递归掩码凭证字段并在事务中批量写入', async () => {
  const state = createWriter();
  const { writer, rows } = state;

  await writer.writeEvents(context, [
    {
      sequence: 0,
      type: 'tool_call',
      messageId: 'message-1',
      toolCallId: 'call-1',
      toolName: 'search',
      args: {
        query: 'coat',
        nested: [{ api_key: 'private-value', count: 2 }],
      },
    },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.payload, {
    query: 'coat',
    nested: [{ api_key: '[REDACTED]', count: 2 }],
  });
  assert.equal(state.flushCount, 1);
});

test('同一事件重放幂等，不同内容复用序号时拒绝覆盖', async () => {
  const { writer, rows } = createWriter();
  const event = {
    sequence: 0,
    type: 'tool_call' as const,
    messageId: 'message-1',
    toolCallId: 'call-1',
    toolName: 'search',
    args: { query: 'coat' },
  };

  await writer.writeEvents(context, [event]);
  await writer.writeEvents(context, [event]);
  assert.equal(rows.length, 1);

  await assert.rejects(
    writer.writeEvents(context, [{ ...event, args: { query: 'shoes' } }]),
    /幂等冲突/u,
  );
  assert.equal(
    rows[0]?.payload && JSON.stringify(rows[0].payload),
    '{"query":"coat"}',
  );
});

test('payload 超过 32768 字节时拒绝写入且不暴露 payload', async () => {
  const { writer, rows } = createWriter();

  await assert.rejects(
    writer.writeEvents(context, [
      {
        sequence: 0,
        type: 'tool_call',
        messageId: 'message-1',
        toolCallId: 'call-1',
        toolName: 'search',
        args: { data: 'secret-data'.repeat(4000) },
      },
    ]),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message.includes('secret-data'), false);
      return (error as Error).message === '聊天过程事件不符合安全保存要求';
    },
  );
  assert.equal(rows.length, 0);
});

test('过长工具结果和失败详情不会被写入', async () => {
  const { writer, rows } = createWriter();

  await assert.rejects(
    writer.writeEvents(context, [
      {
        sequence: 0,
        type: 'tool_result',
        messageId: 'tool-1',
        toolCallId: 'call-1',
        toolName: 'lookup',
        content: 'x'.repeat(32_769),
        status: 'success',
      },
    ]),
    /安全保存要求/u,
  );
  assert.equal(rows.length, 0);

  await writer.writeEvents(context, [
    {
      sequence: 1,
      type: 'tool_result',
      messageId: 'tool-2',
      toolCallId: 'call-2',
      toolName: 'lookup',
      content: 'provider error with private details',
      status: 'failed',
    },
  ]);
  assert.equal(rows[0]?.content, '工具执行失败');
});

test('模型降级事件保留失败状态和安全来源标记', async () => {
  const { writer, rows } = createWriter();

  await writer.writeEvents(context, [
    {
      sequence: 0,
      type: 'model_response',
      messageId: 'fallback-message',
      content: '试穿结果已生成，但暂时无法生成文字回复。',
      model: 'model',
      usage: null,
      status: 'failed',
      payload: {
        origin: 'server_fallback',
        code: 'TRY_ON_CHAT_MODEL_UNAVAILABLE',
      },
    },
  ]);

  assert.equal(rows[0]?.status, ChatTraceEventStatus.FAILED);
  assert.deepEqual(rows[0]?.payload, {
    origin: 'server_fallback',
    code: 'TRY_ON_CHAT_MODEL_UNAVAILABLE',
  });
});

test('不可序列化的循环 payload 被拒绝', async () => {
  const { writer, rows } = createWriter();
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  await assert.rejects(
    writer.writeEvents(context, [
      {
        sequence: 0,
        type: 'tool_call',
        messageId: 'message-1',
        toolCallId: 'call-1',
        toolName: 'search',
        args: circular,
      },
    ]),
    /不符合安全保存要求/u,
  );
  assert.equal(rows.length, 0);
});

test('模型事件后加公开展示绑定仍可幂等重放，保留绑定且原始字段差异仍冲突', async () => {
  const { writer, rows } = createWriter();
  const event = {
    sequence: 1,
    type: 'model_response' as const,
    messageId: 'langchain-message',
    content: '完成',
    model: 'model',
    usage: null,
    payload: { toolCalls: [] },
  };
  await writer.writeEvents(context, [event]);
  const publicDisplay = { version: 1, assistantMessageId: 'display-message' };
  rows[0]!.payload = { ...event.payload, publicDisplay };
  await writer.writeEvents(context, [event]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.payload, { ...event.payload, publicDisplay });
  assert.equal(rows[0]!.messageId, 'langchain-message');
  await assert.rejects(
    writer.writeEvents(context, [
      { ...event, payload: { toolCalls: [], extra: true } },
    ]),
    /幂等冲突/u,
  );
});

test('原始空 payload 与仅含公开展示的模型 payload 重放保持幂等', async () => {
  const { writer, rows } = createWriter();
  const event = {
    sequence: 1,
    type: 'model_response' as const,
    messageId: 'langchain-message',
    content: '完成',
    model: 'model',
    usage: null,
  };
  await writer.writeEvents(context, [event]);
  rows[0]!.payload = { publicDisplay: { version: 1 } };
  await writer.writeEvents(context, [event]);
  assert.deepEqual(rows[0]!.payload, { publicDisplay: { version: 1 } });
});

test('运行时模型事件禁止占用公开展示保留字段', async () => {
  const { writer, rows } = createWriter();
  await assert.rejects(
    writer.writeEvents(context, [
      {
        sequence: 1,
        type: 'model_response',
        messageId: 'langchain-message',
        content: '完成',
        model: 'model',
        usage: null,
        payload: { publicDisplay: { private: 'sensitive' } },
      },
    ]),
    /安全保存要求/u,
  );
  assert.equal(rows.length, 0);
});

test('空对象模型 payload 绑定公开展示后可重复重放，不能混入其他原始字段', async () => {
  const { writer, rows } = createWriter();
  const event = {
    sequence: 1,
    type: 'model_response' as const,
    messageId: 'langchain-message',
    content: '完成',
    model: 'model',
    usage: null,
    payload: {},
  };
  await writer.writeEvents(context, [event]);
  rows[0]!.payload = { publicDisplay: { version: 1 } };
  await writer.writeEvents(context, [event]);
  assert.deepEqual(rows[0]!.payload, { publicDisplay: { version: 1 } });
  await assert.rejects(
    writer.writeEvents(context, [{ ...event, payload: { extra: true } }]),
    /幂等冲突/u,
  );
});

test('独立及嵌套购买调用、非法调用和结果仅保存白名单副本且不改写原事件', async () => {
  const { writer, rows } = createWriter();
  const nested = {
    toolCalls: [
      {
        id: 'nested-call',
        name: 'update_purchase_draft',
        args: {
          draftId: '11111111-1111-4111-8111-111111111111',
          expectedVersion: 4,
          recipient: { name: '张三', phone: '13812345678' },
          address: '完整地址',
          privateError: 'secret',
        },
      },
    ],
    invalid_tool_calls: [
      {
        id: 'invalid-call',
        name: 'get_purchase_draft',
        args: '{"draftId":"11111111-1111-4111-8111-111111111111","private":"secret"}',
        error: 'raw private error',
      },
    ],
  };
  const original = structuredClone(nested);
  await writer.writeEvents(context, [
    {
      sequence: 1,
      type: 'model_response',
      messageId: 'model',
      content: '',
      model: 'model',
      usage: null,
      payload: nested,
    },
    {
      sequence: 2,
      type: 'tool_call',
      messageId: 'model',
      toolCallId: 'independent-call',
      toolName: 'update_purchase_draft',
      args: {
        draftId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: 5,
        skuId: 'private-sku',
        quantity: 2,
        recipient: { address: 'secret address' },
      },
    },
    {
      sequence: 3,
      type: 'tool_result',
      messageId: 'tool',
      toolCallId: 'independent-call',
      toolName: 'update_purchase_draft',
      content:
        '{"draftId":"11111111-1111-4111-8111-111111111111","version":6,"status":"ready","issues":[{"code":"missing_field","field":"phone","message":"private"}],"recipient":{"address":"secret address"}}',
      status: 'success',
      payload: {
        draftId: '11111111-1111-4111-8111-111111111111',
        recipient: { phone: '13812345678' },
      },
    },
  ]);

  assert.deepEqual(nested, original);
  assert.equal(rows.length, 3);
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes('张三'), false);
  assert.equal(serialized.includes('13812345678'), false);
  assert.equal(serialized.includes('完整地址'), false);
  assert.equal(serialized.includes('secret address'), false);
  assert.equal(serialized.includes('raw private error'), false);
  assert.equal(serialized.includes('privateError'), false);
  assert.match(serialized, /"version":4/u);
  assert.match(serialized, /"changedFields":\["name","phone","recipient"\]/u);
});

test('订单和地址工具的 trace 仅保存专属安全白名单', async () => {
  const { writer, rows } = createWriter();
  await writer.writeEvents(context, [
    {
      sequence: 0,
      type: 'model_response',
      messageId: 'model',
      content: '',
      model: 'model',
      usage: null,
      payload: {
        tool_calls: [
          {
            id: 'orders-call',
            name: 'list_my_orders',
            args: {
              orderNo: 'ORDER-1',
              recipient: '张三',
              phone: '13812345678',
            },
          },
          {
            id: 'addresses-call',
            name: 'list_my_shipping_addresses',
            args: { page: 1, userId: 'private-user-id' },
          },
          {
            id: 'select-call',
            name: 'select_my_shipping_address',
            args: {
              addressId: '11111111-1111-4111-8111-111111111111',
              draftId: '22222222-2222-4222-8222-222222222222',
              expectedVersion: 4,
              phone: '13812345678',
            },
          },
        ],
      },
    },
    {
      sequence: 1,
      type: 'tool_call',
      messageId: 'model',
      toolCallId: 'orders-call',
      toolName: 'list_my_orders',
      args: { orderNo: 'ORDER-1', phone: '13812345678' },
    },
    {
      sequence: 2,
      type: 'tool_result',
      messageId: 'orders-result',
      toolCallId: 'orders-call',
      toolName: 'list_my_orders',
      content: JSON.stringify({
        ok: true,
        orders: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            orderNo: 'ORDER-1',
            status: 'pending_shipment',
            payableAmount: '99.00',
            expiresAt: '2026-11-10T10:00:00.000Z',
            recipientName: '张三',
            recipientPhone: '13812345678',
            recipientAddress: '机密收货地址',
            shipment: { trackingNo: 'PRIVATE-TRACKING' },
            items: [
              {
                productName: '测试上衣',
                color: '黑色',
                size: 'M',
                quantity: 1,
                internalId: 'private-id',
              },
            ],
          },
        ],
      }),
      status: 'success',
    },
    {
      sequence: 3,
      type: 'tool_result',
      messageId: 'address-result',
      toolCallId: 'addresses-call',
      toolName: 'list_my_shipping_addresses',
      content: JSON.stringify({
        items: [
          {
            addressId: '11111111-1111-4111-8111-111111111111',
            isDefault: true,
            displayName: '默认地址',
            recipientName: '张三',
            phone: '13812345678',
            address: '机密收货地址',
            label: '家庭 13812345678',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      status: 'success',
    },
    {
      sequence: 4,
      type: 'tool_result',
      messageId: 'select-result',
      toolCallId: 'select-call',
      toolName: 'select_my_shipping_address',
      content: JSON.stringify({
        ok: true,
        result: {
          draftId: '22222222-2222-4222-8222-222222222222',
          version: 5,
          filled: { name: true, phone: true, address: true },
          recipient: {
            name: '张三',
            phone: '13812345678',
            address: '机密收货地址',
          },
        },
      }),
      status: 'success',
    },
  ]);
  const serialized = JSON.stringify(rows);
  for (const privateValue of [
    '张三',
    '13812345678',
    '机密收货地址',
    'PRIVATE-TRACKING',
    'private-user-id',
    'private-id',
    'recipient',
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
  assert.match(serialized, /"orderNo":"ORDER-1"/u);
  const safeOrders = JSON.parse(
    rows.find(
      (row) =>
        typeof row.content === 'string' && row.content.includes('"orders"'),
    )?.content ?? '{}',
  ) as { ok: boolean; orders: Array<Record<string, unknown>> };
  assert.equal(safeOrders.ok, true);
  assert.equal(safeOrders.orders.length, 1);
  assert.equal(
    safeOrders.orders[0]?.id,
    '55555555-5555-4555-8555-555555555555',
  );
  assert.equal(safeOrders.orders[0]?.expiresAt, '2026-11-10T10:00:00.000Z');
  assert.match(serialized, /默认地址/u);
  assert.match(
    serialized,
    /"addressId":"11111111-1111-4111-8111-111111111111"/u,
  );
});

test('get_my_information trace 仅保存查询条件和 section 计数', async () => {
  const { writer, rows } = createWriter();
  const addressId = '66666666-6666-4666-8666-666666666666';
  await writer.writeEvents(context, [
    {
      sequence: 0,
      type: 'model_response',
      messageId: 'information-model',
      content: '',
      model: 'model',
      usage: null,
      payload: {
        tool_calls: [
          {
            id: 'information-call',
            name: 'get_my_information',
            args: {
              sections: ['addresses', 'photos'],
              page: 1,
              userId: 'private-user',
            },
          },
        ],
      },
    },
    {
      sequence: 1,
      type: 'tool_call',
      messageId: 'information-model',
      toolCallId: 'information-call',
      toolName: 'get_my_information',
      args: {
        sections: ['addresses', 'photos'],
        page: 1,
        userId: 'private-user',
      },
    },
    {
      sequence: 2,
      type: 'tool_result',
      messageId: 'information-result',
      toolCallId: 'information-call',
      toolName: 'get_my_information',
      content: JSON.stringify({
        ok: true,
        sections: {
          addresses: {
            items: [
              {
                addressId,
                isDefault: true,
                displayName: '默认地址',
                recipientName: '测试用户',
                phone: '13800000000',
                address: '仅供测试的完整地址',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 5,
          },
          photos: {
            items: [
              {
                photoId: '77777777-7777-4777-8777-777777777777',
                objectKey: 'private/object/key',
                mimeType: 'image/jpeg',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 5,
          },
        },
        errors: [],
      }),
      status: 'success',
    },
  ]);

  const serialized = JSON.stringify(rows);
  for (const privateValue of [
    addressId,
    'private-user',
    '测试用户',
    '13800000000',
    '仅供测试的完整地址',
    '77777777-7777-4777-8777-777777777777',
    'private/object/key',
    'recipientName',
    'objectKey',
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
  const result = rows.find(
    (row) =>
      row.eventType === 'tool_result' && row.toolName === 'get_my_information',
  );
  assert.ok(result?.content);
  assert.deepEqual(JSON.parse(result.content), {
    ok: true,
    sections: {
      addresses: { itemCount: 1, total: 1, page: 1 },
      photos: { itemCount: 1, total: 1, page: 1 },
    },
    errors: [],
  });
});

test('试穿查询独立与嵌套非法调用仅保留枚举，结果与 payload 不持久化任务条目', async () => {
  const { writer, rows } = createWriter();
  const taskId = '88888888-8888-4888-8888-888888888888';
  const args = {
    sections: ['try_on_tasks', 'unknown', 'try_on_tasks'],
    tryOnStatus: 'processing',
    page: 10,
    taskId,
    photoId: 'private-photo',
    imageUrl: 'https://private.example/result',
    objectKey: 'private/object',
    provider: 'private-provider',
  };
  const nested = {
    nested: {
      toolCalls: [{ name: 'get_my_information', id: 'nested-call', args }],
      invalid_tool_calls: [
        {
          name: 'get_my_information',
          id: 'invalid-call',
          args: JSON.stringify({ ...args, page: 11, tryOnStatus: 'deleted' }),
          error: 'private parse error',
        },
      ],
      tool_calls: [
        {
          name: 'get_my_information',
          arguments: JSON.stringify(args),
        },
      ],
    },
  };
  const result = {
    ok: true,
    sections: {
      try_on_tasks: {
        items: [
          {
            taskId,
            product: { name: 'private-product' },
            objectKey: 'private/object',
          },
        ],
        total: 6,
        page: 2,
        privateField: 'private-section',
      },
      unknown: { items: [{ private: 'private-unknown' }] },
    },
    errors: [
      {
        section: 'try_on_tasks',
        code: 'unavailable',
        message: 'private database error',
      },
      { section: 'unknown', code: 'unavailable' },
      { section: 'photos', code: 'private-error' },
    ],
  };
  const original = structuredClone({ nested, args, result });
  await writer.writeEvents(context, [
    {
      sequence: 0,
      type: 'model_response',
      messageId: 'model',
      content: '',
      model: 'model',
      usage: null,
      payload: nested,
    },
    {
      sequence: 1,
      type: 'tool_call',
      messageId: 'model',
      toolCallId: 'task-call',
      toolName: 'get_my_information',
      args,
    },
    {
      sequence: 2,
      type: 'tool_result',
      messageId: 'tool',
      toolCallId: 'task-call',
      toolName: 'get_my_information',
      content: JSON.stringify(result),
      payload: result,
      status: 'success',
    },
  ]);
  assert.deepEqual({ nested, args, result }, original);
  assert.deepEqual(rows[1]?.payload, {
    sections: ['try_on_tasks'],
    page: 10,
    tryOnStatus: 'processing',
  });
  const safeResult = {
    ok: true,
    sections: { try_on_tasks: { itemCount: 1, total: 6, page: 2 } },
    errors: [{ section: 'try_on_tasks', code: 'unavailable' }],
  };
  assert.deepEqual(JSON.parse(rows[2]?.content ?? '{}'), safeResult);
  assert.deepEqual(rows[2]?.payload, safeResult);
  assert.deepEqual(rows[0]?.payload, {
    nested: {
      toolCalls: [
        {
          name: 'get_my_information',
          id: 'nested-call',
          args: {
            sections: ['try_on_tasks'],
            page: 10,
            tryOnStatus: 'processing',
          },
        },
      ],
      invalid_tool_calls: [
        {
          name: 'get_my_information',
          id: 'invalid-call',
          args: { sections: ['try_on_tasks'] },
        },
      ],
      tool_calls: [
        {
          name: 'get_my_information',
          args: {
            sections: ['try_on_tasks'],
            page: 10,
            tryOnStatus: 'processing',
          },
        },
      ],
    },
  });
  const serialized = JSON.stringify(rows);
  for (const forbidden of [
    taskId,
    'private',
    'objectKey',
    'imageUrl',
    'photoId',
    'provider',
    'taskId',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('信息 trace 不保留非法分页、未知状态、错误枚举和原始失败内容', async () => {
  const { writer, rows } = createWriter();
  for (const [index, page] of [0, 11, 1.5, '1'].entries()) {
    await writer.writeEvents(context, [
      {
        sequence: index,
        type: 'tool_call',
        messageId: 'model',
        toolCallId: `invalid-${index}`,
        toolName: 'get_my_information',
        args: {
          sections: ['try_on_tasks'],
          page,
          tryOnStatus: 'private-invalid',
        },
      },
    ]);
    assert.deepEqual(rows[index]?.payload, { sections: ['try_on_tasks'] });
  }
  await writer.writeEvents(context, [
    {
      sequence: 4,
      type: 'tool_result',
      messageId: 'tool',
      toolCallId: 'invalid-result',
      toolName: 'get_my_information',
      content: 'private failure',
      status: 'failed',
      payload: {
        sections: { try_on_tasks: { items: [], total: -1, page: 11 } },
        errors: [
          {
            section: 'try_on_tasks',
            code: 'unavailable',
            raw: 'private failure',
          },
        ],
      },
    },
  ]);
  assert.equal(rows[4]?.content, '工具执行失败');
  assert.deepEqual(rows[4]?.payload, {
    sections: { try_on_tasks: { itemCount: 0 } },
    errors: [{ section: 'try_on_tasks', code: 'unavailable' }],
  });
  assert.equal(JSON.stringify(rows).includes('private'), false);
});

test('卡片工具 trace 仅保存引用参数和通过 schema 的公开卡片', async () => {
  const { writer, rows } = createWriter();
  const card = {
    type: 'card',
    name: 'product',
    data: {
      items: [
        {
          externalId: 'coat-1',
          name: '羊毛外套',
          brand: null,
          category: 'outerwear',
          description: null,
          imageUrl: null,
          productUrl: null,
          price: '999.00',
          currency: 'CNY',
          sizes: ['M'],
          colors: ['黑色'],
          inStock: true,
          tryOnEnabled: false,
          matchReasons: ['category_match'],
        },
      ],
    },
  };

  await writer.writeEvents(context, [
    {
      sequence: 0,
      type: 'model_response',
      messageId: 'card-model',
      content: '',
      model: 'test-model',
      usage: null,
      payload: {
        tool_calls: [
          {
            id: 'nested-card',
            name: 'display_chat_card',
            args: {
              name: 'order',
              orderNos: ['ORDER-1'],
              recipient: '张三',
            },
          },
        ],
      },
    },
    {
      sequence: 1,
      type: 'tool_call',
      messageId: 'card-model',
      toolCallId: 'valid-card',
      toolName: 'display_chat_card',
      args: { name: 'product', externalIds: ['coat-1'] },
    },
    {
      sequence: 2,
      type: 'tool_result',
      messageId: 'card-result',
      toolCallId: 'valid-card',
      toolName: 'display_chat_card',
      content: JSON.stringify(card),
      status: 'success',
    },
    {
      sequence: 3,
      type: 'tool_call',
      messageId: 'invalid-card-model',
      toolCallId: 'invalid-card',
      toolName: 'display_chat_card',
      args: {
        name: 'order',
        orderNos: ['ORDER-1'],
        recipient: '张三',
      },
    },
    {
      sequence: 4,
      type: 'tool_result',
      messageId: 'invalid-card-result',
      toolCallId: 'invalid-card',
      toolName: 'display_chat_card',
      content: JSON.stringify({
        ...card,
        data: {
          items: [{ ...card.data.items[0], recipient: '张三' }],
        },
      }),
      status: 'success',
    },
  ]);

  assert.deepEqual(rows[0]?.payload, {
    tool_calls: [
      {
        id: 'nested-card',
        name: 'display_chat_card',
        args: {},
      },
    ],
  });
  assert.deepEqual(rows[1]?.payload, {
    name: 'product',
    externalIds: ['coat-1'],
  });
  assert.deepEqual(JSON.parse(rows[2]?.content ?? '{}'), card);
  assert.deepEqual(rows[3]?.payload, {});
  assert.deepEqual(JSON.parse(rows[4]?.content ?? '{}'), {});
  assert.equal(JSON.stringify(rows).includes('张三'), false);
});
