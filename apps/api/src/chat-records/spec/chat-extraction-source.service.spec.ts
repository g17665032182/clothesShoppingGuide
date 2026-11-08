import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatConversation } from '../entity/chat-conversation.entity.js';
import {
  ChatMessage,
  ChatRecordMessageRole,
} from '../entity/chat-message.entity.js';
import { ChatExtractionSourceService } from '../extraction-source/chat-extraction-source.service.js';

const conversationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

function fixture() {
  const messages = new Map<string, ChatMessage>();
  let ownsConversation = true;
  const transaction = {
    getConnection: () => ({
      execute: async () => [],
    }),
    getTransactionContext: () => undefined,
    transactional: async <T>(callback: (manager: never) => Promise<T>) =>
      callback(transaction as never),
    findOne: async (
      entity: typeof ChatConversation | typeof ChatMessage,
      where: Record<string, unknown>,
    ) => {
      if (entity === ChatConversation) {
        return ownsConversation
          ? ({ id: conversationId, userId } as ChatConversation)
          : null;
      }
      return messages.get(String(where.id)) ?? null;
    },
    find: async (
      _entity: typeof ChatMessage,
      where: Record<string, unknown>,
    ) => {
      const ids = (where.id as { $in?: string[] } | undefined)?.$in ?? [];
      return [...messages.values()].filter(
        (message) =>
          ids.includes(message.id) &&
          message.conversationId === where.conversationId &&
          message.role === where.role,
      );
    },
  };
  const repository = {
    getEntityManager: () => ({ fork: () => transaction }),
  };
  const source = new ChatExtractionSourceService(
    repository as never,
    { isActive: async () => true } as never,
  );
  const addTurn = (
    index: number,
    eligible = true,
  ): { userMessageId: string; assistantMessageId: string } => {
    const userMessageId = `user-${index}`;
    const assistantMessageId = `assistant-${index}`;
    messages.set(
      userMessageId,
      Object.assign(new ChatMessage(), {
        id: userMessageId,
        conversationId,
        role: ChatRecordMessageRole.USER,
        content: `用户 ${index}`,
        memoryExtractionEligible: eligible,
      }),
    );
    messages.set(
      assistantMessageId,
      Object.assign(new ChatMessage(), {
        id: assistantMessageId,
        conversationId,
        role: ChatRecordMessageRole.ASSISTANT,
        content: `助手 ${index}`,
        memoryExtractionEligible: eligible,
      }),
    );
    return { userMessageId, assistantMessageId };
  };

  return {
    source,
    addTurn,
    setOwnsConversation: (value: boolean) => {
      ownsConversation = value;
    },
  };
}

test('单轮来源保留实际消息 ID，并拒绝不具备提取资格的旧消息', async () => {
  const f = fixture();
  const eligible = f.addTurn(1);
  assert.deepEqual(
    await f.source.readTurn({
      userId,
      conversationId,
      ...eligible,
    }),
    {
      ...eligible,
      userMessage: '用户 1',
      assistantMessage: '助手 1',
    },
  );
  const excluded = f.addTurn(2, false);
  assert.equal(
    await f.source.readTurn({
      userId,
      conversationId,
      ...excluded,
    }),
    null,
  );
});

test('批量来源过滤不合格轮次但保留合法 ID，区分空批次和来源失效', async () => {
  const f = fixture();
  const legal = f.addTurn(1);
  const excluded = f.addTurn(2, false);
  const input = { userId, conversationId, turns: [excluded, legal] };
  assert.deepEqual(await f.source.readTurns(input), [
    { ...legal, userMessage: '用户 1', assistantMessage: '助手 1' },
  ]);
  assert.deepEqual(
    await f.source.readTurns({
      ...input,
      turns: [excluded],
    }),
    [],
  );
  assert.equal(
    await f.source.readTurns({
      ...input,
      turns: [{ userMessageId: 'missing', assistantMessageId: 'missing-ai' }],
    }),
    null,
  );
  f.setOwnsConversation(false);
  assert.equal(await f.source.readTurns(input), null);
});
