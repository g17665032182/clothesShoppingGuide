import assert from 'node:assert/strict';
import test from 'node:test';

import { UserMemoryExtractorService } from '../service/user-memory-extractor.service.js';
import { UserMemoryTaskStatus } from '../entity/user-memory-task.entity.js';

test('记忆关闭时不读取聊天原文也不调用提取模型', async () => {
  let chatRead = false;
  let modelCalled = false;
  const service = new UserMemoryExtractorService(
    {
      async generate() {
        modelCalled = true;
        return { content: '{"operations":[]}' };
      },
    } as never,
    {
      getEntityManager() {
        return {
          fork() {
            chatRead = true;
            throw new Error('禁用时不应读取聊天消息');
          },
        };
      },
    } as never,
    {} as never,
    {
      findOne: async () => ({ enabled: false }),
    } as never,
  );

  await service.process({
    id: 'task-1',
    userId: 'user-1',
    conversationId: 'conversation-1',
    userMessageId: 'user-message-1',
    assistantMessageId: 'assistant-message-1',
    status: UserMemoryTaskStatus.PROCESSING,
  } as never);

  assert.equal(chatRead, false);
  assert.equal(modelCalled, false);
});
