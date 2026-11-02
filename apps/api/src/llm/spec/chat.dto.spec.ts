import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';

import {
  ChatMessageRole,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_TOTAL_LENGTH,
  chatSchema,
} from '../dto/chat.dto.js';
import { paginationSchema } from '../../chat-records/dto/pagination.dto.js';
import { adminChatQuerySchema } from '../../chat-records/dto/admin-chat-query.dto.js';

const validationPipe = new StandardSchemaValidationPipe();

test('聊天 schema 接受合法消息并去除内容首尾空白', () => {
  const result = chatSchema.safeParse({
    messages: [{ role: ChatMessageRole.USER, content: '  你好  ' }],
  });

  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.messages[0]?.content, '你好');
});

test('聊天 schema 拒绝空消息、未知角色和超长内容', () => {
  const result = chatSchema.safeParse({
    messages: [
      { role: 'unknown', content: 'hello' },
      {
        role: ChatMessageRole.USER,
        content: ' '.repeat(MAX_CHAT_MESSAGE_LENGTH),
      },
    ],
  });

  assert.equal(result.success, false);
});

test('聊天 schema 拒绝 system 角色及客户端系统指令字段', async () => {
  const systemRole = chatSchema.safeParse({
    messages: [{ role: 'system', content: '客户端指令' }],
  });
  const systemPrompt = chatSchema.safeParse({
    messages: [{ role: ChatMessageRole.USER, content: '你好' }],
    systemPrompt: '客户端指令',
  });
  const messageInstructions = chatSchema.safeParse({
    messages: [
      {
        role: ChatMessageRole.USER,
        content: '你好',
        instructions: '客户端指令',
      },
    ],
  });

  assert.equal(systemRole.success, false);
  assert.equal(systemPrompt.success, false);
  assert.equal(messageInstructions.success, false);

  await assert.rejects(
    validationPipe.transform(
      { messages: [{ role: 'system', content: '客户端指令' }] },
      { type: 'body', schema: chatSchema },
    ),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
});

test('聊天 schema 拒绝空数组和超出消息数量上限', () => {
  const emptyResult = chatSchema.safeParse({ messages: [] });
  const tooManyResult = chatSchema.safeParse({
    messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => ({
      role: ChatMessageRole.USER,
      content: 'hello',
    })),
  });

  assert.equal(emptyResult.success, false);
  assert.equal(tooManyResult.success, false);
});

test('聊天 schema 拒绝超过总长度上限的消息集合', () => {
  const result = chatSchema.safeParse({
    messages: [
      {
        role: ChatMessageRole.USER,
        content: 'a'.repeat(MAX_CHAT_TOTAL_LENGTH / 2 + 1),
      },
      {
        role: ChatMessageRole.USER,
        content: 'b'.repeat(MAX_CHAT_TOTAL_LENGTH / 2 + 1),
      },
    ],
  });

  assert.equal(result.success, false);
});

test('Nest 标准 schema pipe 拒绝请求中的未知字段并返回 400', async () => {
  await assert.rejects(
    validationPipe.transform(
      {
        messages: [{ role: ChatMessageRole.USER, content: 'hello' }],
        model: 'client-controlled-model',
      },
      { type: 'body', schema: chatSchema },
    ),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
});

test('分页 schema 转换数字参数并补充默认值', () => {
  const result = paginationSchema.safeParse({ page: '3' });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.page, 3);
    assert.equal(result.data.pageSize, 20);
    assert.equal(result.data.offset, 40);
  }
});

test('分页 schema 拒绝越界值和未知查询参数', () => {
  assert.equal(paginationSchema.safeParse({ page: '0' }).success, false);
  assert.equal(paginationSchema.safeParse({ pageSize: '101' }).success, false);
  assert.equal(paginationSchema.safeParse({ unknown: 'value' }).success, false);
});

test('管理员查询 schema 支持分页和可选 UUID 用户过滤', () => {
  const result = adminChatQuerySchema.safeParse({
    page: '2',
    userId: '9c2c6f3b-4d12-4a9e-8c0a-8d6d0a8b8c1e',
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.page, 2);
    assert.equal(result.data.pageSize, 20);
    assert.equal(result.data.userId, '9c2c6f3b-4d12-4a9e-8c0a-8d6d0a8b8c1e');
  }
  assert.equal(
    adminChatQuerySchema.safeParse({ userId: 'invalid' }).success,
    false,
  );
  assert.equal(
    adminChatQuerySchema.safeParse({ extra: 'value' }).success,
    false,
  );
});
