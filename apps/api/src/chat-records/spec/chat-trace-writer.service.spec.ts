import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatTraceEvent } from '../entity/chat-trace-event.entity.js';
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
