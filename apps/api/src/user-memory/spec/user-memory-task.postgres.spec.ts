import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RequestContext } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { ServiceUnavailableException } from '@nestjs/common';

import config from '../../mikro-orm.config.js';
import { User } from '../../users/entity/user.entity.js';
import { ChatConversation } from '../../chat-records/entity/chat-conversation.entity.js';
import {
  ChatMessage,
  ChatRecordMessageRole,
} from '../../chat-records/entity/chat-message.entity.js';
import {
  UserMemoryTask,
  UserMemoryTaskStatus,
} from '../entity/user-memory-task.entity.js';
import { UserMemorySetting } from '../entity/user-memory-setting.entity.js';
import { UserMemoryDocumentState } from '../entity/user-memory-document-state.entity.js';
import { UserMemoryDocumentTaskResult } from '../entity/user-memory-document-task-result.entity.js';
import { UserMemoryDocumentCleanup } from '../entity/user-memory-document-cleanup.entity.js';
import { UserMemoryTaskService } from '../service/user-memory-task.service.js';
import { UserMemoryExtractorService } from '../service/user-memory-extractor.service.js';
import { UserMemoryDocumentService } from '../service/user-memory-document.service.js';
import { UserMemoryDocumentCleanupService } from '../service/user-memory-document-cleanup.service.js';
import { UserMemorySettingsService } from '../service/user-memory-settings.service.js';
import { UserMemorySchedulerService } from '../service/user-memory-scheduler.service.js';

test(
  '专用 PostgreSQL：记忆租约、候选重试、清空代次和后台上下文',
  {
    skip: process.env.RUN_PERSONALIZATION_POSTGRES_TEST !== '1',
    timeout: 60_000,
  },
  async () => {
    const dbName = process.env.PERSONALIZATION_TEST_DB;
    assert.ok(dbName);
    assert.ok(
      dbName.includes('test') && dbName !== config.dbName,
      '必须指定独立测试库',
    );
    const entities = [
      User,
      ChatConversation,
      ChatMessage,
      UserMemoryTask,
      UserMemorySetting,
      UserMemoryDocumentState,
      UserMemoryDocumentTaskResult,
      UserMemoryDocumentCleanup,
    ];
    const orm = await MikroORM.init({
      ...config,
      dbName,
      entities,
      entitiesTs: entities,
      debug: false,
    });
    const owner = randomUUID();
    const conversationId = randomUUID();
    const em = orm.em.fork();
    const taskService = new UserMemoryTaskService(
      orm.em.getRepository(UserMemoryTask),
    );
    const settings = new UserMemorySettingsService(
      orm.em.getRepository(UserMemorySetting),
    );
    const objects = new Map<string, Buffer>();
    let failUpload = false;
    let cleanupContextSeen = false;
    const store = {
      putRevision: async (_id: string, _revision: number, content: string) => {
        if (failUpload) throw new ServiceUnavailableException();
        const key = randomUUID();
        objects.set(key, Buffer.from(content));
        return key;
      },
      readObject: async (key: string) => objects.get(key)!,
      deleteObject: async (key: string) => {
        objects.delete(key);
      },
      listObjects: async () => {
        cleanupContextSeen = RequestContext.getEntityManager() !== undefined;
        return { items: [] };
      },
    };
    const cleanup = new UserMemoryDocumentCleanupService(
      orm.em.getRepository(UserMemoryDocumentCleanup),
      store as never,
      orm as never,
    );
    const documents = new UserMemoryDocumentService(
      orm.em.getRepository(UserMemoryDocumentState),
      store as never,
      cleanup,
    );
    let modelCalls = 0;
    const extractor = new UserMemoryExtractorService(
      {
        generate: async () => {
          modelCalls++;
          return {
            content: JSON.stringify({
              operations: [
                {
                  operation: 'append',
                  section: 'clothing',
                  markdown: '长期喜欢天然棉质衣物',
                  explicit: true,
                },
              ],
            }),
          };
        },
      } as never,
      taskService,
      {
        readTurn: async () => ({
          userMessage: '长期喜欢棉质衣物',
          assistantMessage: '好的',
        }),
      },
      documents,
    );
    const input = {
      userId: owner,
      conversationId,
      userMessageId: randomUUID(),
      assistantMessageId: randomUUID(),
    };
    const enqueue = (data = input) =>
      em
        .fork()
        .transactional((tx) => taskService.enqueueInTransaction(tx, data));
    try {
      em.persist(
        Object.assign(new User(), {
          id: owner,
          email: `memory-${owner}@local.invalid`,
          passwordHash: 'test-only',
          displayName: '记忆测试',
        }),
      );
      await em.flush();
      em.persist(
        Object.assign(new ChatConversation(), {
          id: conversationId,
          userId: owner,
          title: '记忆测试',
        }),
      );
      await em.flush();
      em.persist([
        Object.assign(new ChatMessage(), {
          id: input.userMessageId,
          conversationId,
          role: ChatRecordMessageRole.USER,
          content: '长期喜欢棉质衣物',
        }),
        Object.assign(new ChatMessage(), {
          id: input.assistantMessageId,
          conversationId,
          role: ChatRecordMessageRole.ASSISTANT,
          content: '好的',
        }),
      ]);
      await em.flush();
      await Promise.all([settings.get(owner), settings.get(owner)]);
      await enqueue();
      const batches = await Promise.all([
        taskService.claimBatch(),
        taskService.claimBatch(),
      ]);
      const claimed = batches.flat().filter((task) => task.userId === owner);
      assert.equal(claimed.length, 1, '竞争领取只返回一个执行租约');
      const firstLease = claimed[0]!;
      failUpload = true;
      await assert.rejects(
        extractor.process(firstLease),
        ServiceUnavailableException,
      );
      assert.equal(modelCalls, 1);
      await taskService.markFailed(firstLease, 'STORAGE_UNAVAILABLE');
      const cached = await em
        .fork()
        .findOneOrFail(UserMemoryTask, { id: firstLease.id });
      assert.equal(cached.candidateOperations?.length, 1);
      await em.nativeUpdate(
        UserMemoryTask,
        { id: firstLease.id },
        { availableAt: new Date(0) },
      );
      const retry = (await taskService.claimBatch()).find(
        (task) => task.id === firstLease.id,
      )!;
      failUpload = false;
      await extractor.process(retry);
      await taskService.markSucceeded(retry);
      assert.equal(modelCalls, 1, '重试不再次生成模型候选');
      assert.match((await documents.get(owner)).content, /棉质/);
      const finalTask = await em
        .fork()
        .findOneOrFail(UserMemoryTask, { id: retry.id });
      assert.equal(finalTask.candidateOperations, null);
      assert.equal(finalTask.status, UserMemoryTaskStatus.SUCCEEDED);

      await em.nativeUpdate(
        UserMemoryTask,
        { id: retry.id },
        {
          status: UserMemoryTaskStatus.PENDING,
          availableAt: new Date(0),
          attempts: 0,
          lockedAt: null,
        },
      );
      const oldLease = (await taskService.claimBatch()).find(
        (task) => task.id === retry.id,
      )!;
      await em.nativeUpdate(
        UserMemoryTask,
        { id: oldLease.id },
        { lockedAt: new Date(Date.now() - 700_000) },
      );
      await taskService.recoverExpiredProcessing();
      await em.nativeUpdate(
        UserMemoryTask,
        { id: oldLease.id },
        { availableAt: new Date(0) },
      );
      const newLease = (await taskService.claimBatch()).find(
        (task) => task.id === oldLease.id,
      )!;
      assert.equal(newLease.attempts, 2);
      await taskService.markSucceeded(oldLease);
      assert.equal(
        (await em.fork().findOneOrFail(UserMemoryTask, { id: oldLease.id }))
          .status,
        UserMemoryTaskStatus.PROCESSING,
      );
      assert.equal(await taskService.saveCandidates(oldLease, []), false);
      await documents.applyExtractedOperations({
        userId: owner,
        taskId: oldLease.id,
        taskAttempts: oldLease.attempts,
        taskLockedAt: oldLease.lockedAt!,
        documentGeneration: oldLease.documentGeneration,
        operations: [
          {
            operation: 'append',
            section: 'other',
            markdown: '旧租约不得写入',
            explicit: true,
          },
        ],
      });
      assert.doesNotMatch((await documents.get(owner)).content, /旧租约/);
      await taskService.saveCandidates(newLease, [
        {
          operation: 'append',
          section: 'other',
          markdown: '喜欢简洁',
          explicit: true,
        },
      ]);
      await documents.clear(owner);
      assert.equal(
        (await em.fork().findOneOrFail(UserMemoryTask, { id: newLease.id }))
          .candidateOperations,
        null,
      );
      await extractor.process(newLease);
      assert.equal(
        (await documents.get(owner)).content,
        '',
        '旧代次不能复活清空正文',
      );
      await taskService.markSucceeded(newLease);

      // 不借用 HTTP 上下文，实际启动后台入口并观察其独立 RequestContext。
      let contextSeen = false;
      const scheduler = new UserMemorySchedulerService(
        {
          recoverExpiredProcessing: async () => {
            contextSeen = RequestContext.getEntityManager() !== undefined;
            return taskService.recoverExpiredProcessing();
          },
          claimBatch: () => taskService.claimBatch(),
        } as never,
        extractor,
        orm as never,
      );
      scheduler.onModuleInit();
      await scheduler.onModuleDestroy();
      assert.ok(contextSeen);
      cleanup.onModuleInit();
      await cleanup.onModuleDestroy();
      assert.ok(cleanupContextSeen);
      await settings.update(owner, { enabled: false });
      await documents.update(owner, {
        content: '手动仍可编辑',
        expectedRevision: (await documents.get(owner)).revision,
      });
      assert.equal((await documents.get(owner)).content, '手动仍可编辑');
      await em.nativeDelete(UserMemoryTask, { userId: owner });
      await enqueue();
      assert.equal(await em.fork().count(UserMemoryTask, { userId: owner }), 0);
    } finally {
      await cleanup.onModuleDestroy();
      await em.nativeDelete(UserMemoryTask, { userId: owner });
      await em.nativeDelete(UserMemoryDocumentCleanup, { userId: owner });
      await em.nativeDelete(UserMemoryDocumentState, { userId: owner });
      await em.nativeDelete(UserMemorySetting, { userId: owner });
      await em.nativeDelete(ChatMessage, { conversationId });
      await em.nativeDelete(ChatConversation, { id: conversationId });
      await em.nativeDelete(User, { id: owner });
      await orm.close(true);
    }
  },
);
