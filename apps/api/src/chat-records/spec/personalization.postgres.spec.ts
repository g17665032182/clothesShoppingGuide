import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';
import { ChatMessageRole } from '../../llm/dto/chat.dto.js';
import { User, UserStatus } from '../../users/entity/user.entity.js';
import { UsersService } from '../../users/service/users.service.js';
import {
  UserPreference,
  UserPreferenceSourceStatus,
} from '../../user-preferences/entity/user-preference.entity.js';
import { UserPreferenceSetting } from '../../user-preferences/entity/user-preference-setting.entity.js';
import { UserPreferenceTask } from '../../user-preferences/entity/user-preference-task.entity.js';
import { UserPreferenceTaskResult } from '../../user-preferences/entity/user-preference-task-result.entity.js';
import { UserPreferencesService } from '../../user-preferences/service/user-preferences.service.js';
import { UserPreferenceSettingsService } from '../../user-preferences/service/user-preference-settings.service.js';
import { UserPreferenceReaderService } from '../../user-preferences/service/user-preference-reader.service.js';
import { UserPreferenceLifecycleService } from '../../user-preferences/service/user-preference-lifecycle.service.js';
import { lockPreferenceUser } from '../../user-preferences/task/preference-user-lock.js';
import { UserMemorySetting } from '../../user-memory/entity/user-memory-setting.entity.js';
import { UserMemoryTask } from '../../user-memory/entity/user-memory-task.entity.js';
import { UserMemoryDocumentState } from '../../user-memory/entity/user-memory-document-state.entity.js';
import { UserMemoryDocumentTaskResult } from '../../user-memory/entity/user-memory-document-task-result.entity.js';
import { UserMemoryDocumentCleanup } from '../../user-memory/entity/user-memory-document-cleanup.entity.js';
import { UserMemorySettingsService } from '../../user-memory/service/user-memory-settings.service.js';
import { UserMemoryReaderService } from '../../user-memory/service/user-memory-reader.service.js';
import { UserMemoryTaskService } from '../../user-memory/service/user-memory-task.service.js';
import { UserMemoryDocumentService } from '../../user-memory/service/user-memory-document.service.js';
import { UserMemoryDocumentCleanupService } from '../../user-memory/service/user-memory-document-cleanup.service.js';
import type { LlmTraceContext } from '../../llm/trace/llm-trace.types.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import { ChatMessage } from '../entity/chat-message.entity.js';
import { ChatTraceEvent } from '../entity/chat-trace-event.entity.js';
import { ChatContextService } from '../context/chat-context.service.js';
import { ChatDisplayService } from '../display/chat-display.service.js';
import { ChatTraceWriterService } from '../trace/chat-trace-writer.service.js';
import { ChatRecordsService } from '../service/chat-records.service.js';
import { ChatExtractionSourceService } from '../extraction-source/chat-extraction-source.service.js';
import type { ChatExtractionInput } from '../extraction-source/chat-extraction-source.port.js';

test(
  '专用 PostgreSQL：偏好只读、记忆任务故障隔离、外层回滚和来源授权',
  {
    skip: process.env.RUN_PERSONALIZATION_POSTGRES_TEST !== '1',
    timeout: 60_000,
  },
  async (t) => {
    const dbName = process.env.PERSONALIZATION_TEST_DB ?? '';
    assert.match(dbName, /^clothes_guide_separation_test_[a-z0-9_]+$/u);
    assert.notEqual(dbName, config.dbName);
    const entities = [
      User,
      ChatConversation,
      ChatMessage,
      ChatTraceEvent,
      UserPreference,
      UserPreferenceSetting,
      UserPreferenceTask,
      UserPreferenceTaskResult,
      UserMemorySetting,
      UserMemoryTask,
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
    const userId = randomUUID();
    const em = orm.em.fork();
    const owner = Object.assign(new User(), {
      id: userId,
      email: `${userId}@local.invalid`,
      displayName: 'isolation fixture',
      passwordHash: 'fixture-no-login',
    });
    const objects = new Map<string, Buffer>();
    const store = {
      async putRevision(_userId: string, _revision: number, content: string) {
        const key = `fixture-${randomUUID()}`;
        objects.set(key, Buffer.from(content));
        return key;
      },
      async readObject(key: string) {
        const content = objects.get(key);
        if (!content) throw new Error('fixture missing');
        return content;
      },
    };
    const preferenceSettings = new UserPreferenceSettingsService(
      em.getRepository(UserPreferenceSetting),
    );
    const memorySettings = new UserMemorySettingsService(
      em.getRepository(UserMemorySetting),
    );
    const preferences = new UserPreferencesService(
      em.getRepository(UserPreference),
      preferenceSettings,
    );
    const preferenceLifecycle = new UserPreferenceLifecycleService();
    const memoryTasks = new UserMemoryTaskService(
      em.getRepository(UserMemoryTask),
      { ownsConversation: async () => true } as never,
    );
    const cleanup = new UserMemoryDocumentCleanupService(
      em.getRepository(UserMemoryDocumentCleanup),
      store as never,
      orm,
    );
    const documents = new UserMemoryDocumentService(
      em.getRepository(UserMemoryDocumentState),
      store as never,
      cleanup,
    );
    const preferenceReader = new UserPreferenceReaderService(
      em.getRepository(UserPreference),
    );
    const memoryReader = new UserMemoryReaderService(
      em.getRepository(UserMemorySetting),
      documents,
    );
    const source = new ChatExtractionSourceService(
      em.getRepository(ChatConversation),
      new UsersService(em.getRepository(User)),
    );
    const context = new ChatContextService(
      new ConfigService({
        LLM_CONTEXT_WINDOW_TOKENS: '8192',
        LLM_TOKEN_ENCODING: 'cl100k_base',
      }),
      {
        createSystemContextMessage: () => ({ content: 'system' }),
      } as never,
    );
    let mode: 'normal' | 'memory-sql' | 'outer' = 'normal';
    let captured: ChatExtractionInput | undefined;
    const service = new ChatRecordsService(
      em.getRepository(ChatConversation),
      em.getRepository(ChatMessage),
      em.getRepository(ChatTraceEvent),
      {
        assertConfigured: () => 'fake',
        chatPrepared: async (
          _input: unknown,
          traceContext: LlmTraceContext,
        ) => {
          // 假模型仍通过真实 trace writer 满足聊天持久化所需的最终事件绑定。
          await traceContext.writer.writeEvents(
            {
              conversationId: traceContext.conversationId,
              runId: traceContext.runId,
            },
            [
              {
                sequence: 0,
                type: 'input',
                messageId: null,
                content: 'style 通勤',
              },
              {
                sequence: 1,
                type: 'model_response',
                messageId: null,
                content: 'fixture reply',
                model: 'fake',
                usage: null,
              },
            ],
          );
          return {
            content: 'fixture reply',
            model: 'fake',
            usage: null,
            finalTraceSequence: 1,
          };
        },
      } as never,
      context,
      { summarize: async () => null } as never,
      new ChatTraceWriterService(em.getRepository(ChatTraceEvent)),
      memoryReader,
      {
        async enqueueInTransaction(transaction, input) {
          captured = input;
          if (mode === 'memory-sql') {
            await transaction
              .getConnection()
              .execute(
                'select 1 / 0',
                [],
                'all',
                transaction.getTransactionContext(),
              );
          }
          await memoryTasks.enqueueInTransaction(transaction, input);
          if (mode === 'outer') throw new Error('controlled outer rollback');
        },
      },
      preferenceLifecycle,
      new ChatDisplayService(em.getRepository(ChatTraceEvent), {
        getTryOnProducts: async () => new Map(),
      } as never),
      preferenceReader,
      {} as never,
      {
        runState: async () => ({
          fingerprint: '',
          active: false,
          context: '',
          reference: null,
        }),
        runStateInTransaction: async () => ({
          fingerprint: '',
          active: false,
          context: '',
          reference: null,
        }),
      } as never,
      { lockOwnedInTransaction: async () => undefined } as never,
    );
    const chat = () =>
      service.chat(owner, {
        messages: [{ role: ChatMessageRole.USER, content: 'style 通勤' }],
      });
    try {
      await em.persist(owner).flush();
      const preference = await preferences.create(userId, {
        category: 'style',
        value: { items: ['casual'] },
        isPrimary: false,
      });
      await documents.update(userId, {
        content: '## 服装与购物\n\n通勤时喜欢舒适面料。',
        expectedRevision: 0,
      });
      for (const preferenceEnabled of [false, true]) {
        for (const memoryEnabled of [false, true]) {
          await preferenceSettings.updateSettings(userId, {
            enabled: preferenceEnabled,
          });
          await memorySettings.update(userId, { enabled: memoryEnabled });
          // 多轮集成测试复用服务对象；清空 identity map 模拟真实请求间的新上下文。
          em.clear();
          assert.equal(
            (await preferenceReader.readContext(userId, 'style')).length > 0,
            preferenceEnabled,
          );
          assert.equal(
            (await memoryReader.readContext(userId, '通勤')).length > 0,
            memoryEnabled,
          );
          const result = await chat();
          const fresh = orm.em.fork();
          assert.equal(
            await fresh.count(UserPreferenceTask, {
              conversationId: result.conversationId,
            }),
            0,
          );
          assert.equal(
            await fresh.count(UserMemoryTask, {
              conversationId: result.conversationId,
            }),
            Number(memoryEnabled),
            `偏好开关=${preferenceEnabled}，记忆开关=${memoryEnabled}`,
          );
          // 关闭读取时，两个领域依然允许人工管理。
          await preferences.update(userId, preference.id, {
            isPrimary: preferenceEnabled,
          });
          assert.equal(
            (await documents.get(userId)).content.includes('通勤'),
            true,
          );
        }
      }
      t.diagnostic('四种开关组合不产生偏好任务，关闭不影响人工管理');
      {
        mode = 'memory-sql';
        const result = await chat();
        const fresh = orm.em.fork();
        assert.equal(
          await fresh.count(ChatMessage, {
            conversationId: result.conversationId,
          }),
          2,
        );
        assert.equal(
          await fresh.count(UserPreferenceTask, {
            conversationId: result.conversationId,
          }),
          0,
        );
        assert.equal(
          await fresh.count(UserMemoryTask, {
            conversationId: result.conversationId,
          }),
          0,
        );
      }
      t.diagnostic('记忆任务真实SQL错误回滚savepoint后，聊天仍提交');
      mode = 'outer';
      await assert.rejects(chat(), /controlled outer rollback/u);
      assert.ok(captured);
      const fresh = orm.em.fork();
      assert.equal(
        await fresh.count(ChatMessage, {
          conversationId: captured.conversationId,
        }),
        0,
      );
      assert.equal(
        await fresh.count(UserPreferenceTask, {
          conversationId: captured.conversationId,
        }),
        0,
      );
      assert.equal(
        await fresh.count(UserMemoryTask, {
          conversationId: captured.conversationId,
        }),
        0,
      );
      mode = 'normal';
      await chat();
      assert.ok(captured);
      assert.deepEqual(await source.readTurn(captured), {
        userMessageId: captured.userMessageId,
        assistantMessageId: captured.assistantMessageId,
        userMessage: 'style 通勤',
        assistantMessage: 'fixture reply',
      });
      assert.equal(
        await source.readTurn({ ...captured, userId: randomUUID() }),
        null,
      );
      assert.equal(
        await source.readTurn({
          ...captured,
          userMessageId: captured.assistantMessageId,
        }),
        null,
      );
      const conversationId = captured.conversationId;
      await fresh.nativeUpdate(
        UserPreference,
        { id: preference.id },
        {
          sourceConversationId: conversationId,
          sourceStatus: UserPreferenceSourceStatus.ACTIVE,
        },
      );
      await orm.em.fork().transactional(async (holder) => {
        await lockPreferenceUser(holder, userId);
        await assert.rejects(
          orm.em.fork().transactional(async (contender) => {
            await contender
              .getConnection()
              .execute(
                "set local lock_timeout = '150ms'",
                [],
                'run',
                contender.getTransactionContext(),
              );
            await preferenceLifecycle.markConversationDeleted(
              contender,
              conversationId,
              userId,
            );
          }),
          (error: unknown) =>
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '55P03',
        );
      });
      await service.deleteForUser(userId, conversationId);
      const deletedSource = await orm.em
        .fork()
        .findOneOrFail(UserPreference, { id: preference.id });
      assert.equal(deletedSource.sourceStatus, 'deleted');
      assert.equal(deletedSource.sourceConversationId, null);
      assert.equal(await source.readTurn(captured), null);
      await chat();
      assert.ok(captured);
      await fresh.nativeUpdate(
        User,
        { id: userId },
        { status: UserStatus.DISABLED },
      );
      assert.equal(await source.readTurn(captured), null);
      t.diagnostic(
        '外层回滚无遗留任务；会话删除遵守领域锁序并更新来源；拒绝错用户、错角色和禁用用户',
      );
    } finally {
      const cleanupEm = orm.em.fork();
      const keys = await cleanupEm.find(UserMemoryDocumentCleanup, { userId });
      for (const row of keys) objects.delete(row.objectKey);
      await cleanupEm.nativeDelete(UserMemoryDocumentCleanup, { userId });
      await cleanupEm.nativeDelete(User, { id: userId });
      await orm.close();
    }
  },
);
