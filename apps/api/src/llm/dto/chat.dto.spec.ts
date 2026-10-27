import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ChatDto,
  ChatMessageRole,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_TOTAL_LENGTH,
} from './chat.dto.js';

test('ChatDto 接受合法消息并去除内容首尾空白', async () => {
  const dto = plainToInstance(ChatDto, {
    messages: [{ role: ChatMessageRole.USER, content: '  你好  ' }],
  });

  const errors = await validate(dto);

  assert.equal(errors.length, 0);
  assert.equal(dto.messages[0]?.content, '你好');
});

test('ChatDto 拒绝空消息、未知角色和超长内容', async () => {
  const dto = plainToInstance(ChatDto, {
    messages: [
      { role: 'unknown', content: 'hello' },
      {
        role: ChatMessageRole.USER,
        content: ' '.repeat(MAX_CHAT_MESSAGE_LENGTH),
      },
    ],
  });

  const errors = await validate(dto);

  assert.ok(errors.length > 0);
});

test('ChatDto 拒绝空数组和超出消息数量上限', async () => {
  const emptyDto = plainToInstance(ChatDto, { messages: [] });
  const tooManyDto = plainToInstance(ChatDto, {
    messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => ({
      role: ChatMessageRole.USER,
      content: 'hello',
    })),
  });

  assert.ok((await validate(emptyDto)).length > 0);
  assert.ok((await validate(tooManyDto)).length > 0);
});

test('ChatDto 拒绝超过总长度上限的消息集合', async () => {
  const dto = plainToInstance(ChatDto, {
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

  assert.ok((await validate(dto)).length > 0);
});

test('全局校验配置拒绝请求中的未知字段', async () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  await assert.rejects(
    pipe.transform(
      {
        messages: [{ role: ChatMessageRole.USER, content: 'hello' }],
        model: 'client-controlled-model',
      },
      { type: 'body', metatype: ChatDto },
    ),
  );
});
