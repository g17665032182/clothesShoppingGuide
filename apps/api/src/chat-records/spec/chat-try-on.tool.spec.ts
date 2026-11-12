import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolMessage } from '@langchain/core/messages';

import type { ChatTryOnPort } from '../../virtual-try-on/port/chat-try-on.port.js';
import { createChatTryOnTool } from '../try-on/chat-try-on.tool.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PHOTO_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';

test('试穿工具将用户、颜色和同意绑定到 Port 上下文', async () => {
  const calls: unknown[] = [];
  const port: ChatTryOnPort = {
    run: async (input) => {
      calls.push(input);
      return {
        status: 'succeeded',
        result: {
          taskId: TASK_ID,
          product: {
            externalId: 'coat-1',
            name: '试穿大衣',
            color: '黑色',
          },
          result: {
            width: 1200,
            height: 1600,
            mimeType: 'image/webp',
          },
          image: Buffer.from('synthetic-image-bytes'),
        },
      };
    },
    canReadResult: async () => true,
  };
  const tool = createChatTryOnTool(port, {
    userId: USER_ID,
    color: '黑色',
    consentVersion: 'v1',
  });

  const result = await tool.invoke({
    type: 'tool_call',
    id: 'call-1',
    name: 'try_on_product',
    args: { productExternalId: 'coat-1', photoId: PHOTO_ID },
  });

  assert.equal(result instanceof ToolMessage, true);
  assert.deepEqual(calls, [
    {
      userId: USER_ID,
      productExternalId: 'coat-1',
      color: '黑色',
      photoId: PHOTO_ID,
      consentVersion: 'v1',
    },
  ]);
  assert.equal(
    result.content,
    JSON.stringify({ status: 'succeeded', taskId: TASK_ID }),
  );
  assert.deepEqual(result.artifact, {
    status: 'succeeded',
    result: {
      taskId: TASK_ID,
      product: {
        externalId: 'coat-1',
        name: '试穿大衣',
        color: '黑色',
      },
      result: {
        width: 1200,
        height: 1600,
        mimeType: 'image/webp',
      },
      image: Buffer.from('synthetic-image-bytes'),
    },
  });
  assert.equal(result.content.includes(PHOTO_ID), false);
  assert.equal(result.content.includes('synthetic-image-bytes'), false);
});

test('试穿工具拒绝工具参数中的未知字段', async () => {
  let called = false;
  const tool = createChatTryOnTool(
    {
      run: async () => {
        called = true;
        return { status: 'failed', code: 'TRY_ON_UNAVAILABLE' };
      },
      canReadResult: async () => true,
    },
    {
      userId: USER_ID,
      color: '黑色',
      consentVersion: 'v1',
    },
  );

  await assert.rejects(
    tool.invoke({
      type: 'tool_call',
      id: 'call-1',
      name: 'try_on_product',
      args: {
        productExternalId: 'coat-1',
        photoId: PHOTO_ID,
        userId: 'attacker-controlled',
      },
    }),
  );
  assert.equal(called, false);
});
