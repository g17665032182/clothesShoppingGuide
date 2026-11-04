import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '@mikro-orm/core';

import config from '../../mikro-orm.config.js';
import { UserPreference } from '../entity/user-preference.entity.js';
import { UserPreferenceSetting } from '../entity/user-preference-setting.entity.js';
import { UserPreferenceTask } from '../entity/user-preference-task.entity.js';
import { UserPreferenceTaskResult } from '../entity/user-preference-task-result.entity.js';
import { UserPreferenceTaskService } from '../service/user-preference-task.service.js';
import { UserPreferenceExtractorService } from '../service/user-preference-extractor.service.js';
import { UserPreferenceSchedulerService } from '../service/user-preference-scheduler.service.js';
import { UserPreferenceSettingsService } from '../service/user-preference-settings.service.js';
import { UserPreferencesService } from '../service/user-preferences.service.js';
import { UserPreferenceReaderService } from '../service/user-preference-reader.service.js';

const enabled = process.env.RUN_PERSONALIZATION_POSTGRES_TEST === '1';

test(
  '真实 PostgreSQL 偏好任务：后台上下文、租约、候选重试和删除隔离',
  {
    skip: !enabled,
    timeout: 60_000,
  },
  async () => {
    const dbName = process.env.PERSONALIZATION_TEST_DB;
    assert.ok(dbName, '必须显式指定测试库');
    assert.ok(dbName.includes('test'), '必须显式使用可销毁测试库');
    const schema = `preference_test_${randomUUID().replaceAll('-', '')}`;
    const orm = await MikroORM.init({
      ...config,
      dbName,
      schema,
      entities: [
        UserPreference,
        UserPreferenceSetting,
        UserPreferenceTask,
        UserPreferenceTaskResult,
      ],
      entitiesTs: [],
      allowGlobalContext: false,
      debug: false,
      driverOptions: {
        ...config.driverOptions,
        options: `-c search_path=${schema},public`,
      },
    });
    const connection = orm.em.getConnection();
    let scheduler: UserPreferenceSchedulerService | undefined;
    try {
      // 每个文件使用自己的 schema，避免并行测试的调度器领取对方夹具。
      await connection.execute(`create schema "${schema}"`);
      for (const table of [
        'user_preferences',
        'user_preference_settings',
        'user_preference_tasks',
        'user_preference_task_results',
      ]) {
        await connection.execute(
          `create table "${schema}"."${table}" (like public."${table}" including all)`,
        );
      }
      await connection.execute(
        `alter table "${schema}".user_preference_task_results add foreign key (task_id) references "${schema}".user_preference_tasks(id) on delete cascade`,
      );
      const em = orm.em.fork();
      const tasks = new UserPreferenceTaskService(
        em.getRepository(UserPreferenceTask),
      );
      const settings = new UserPreferenceSettingsService(
        em.getRepository(UserPreferenceSetting),
      );
      const preferences = new UserPreferencesService(
        em.getRepository(UserPreference),
        settings,
      );
      const userId = randomUUID();
      let modelCalls = 0;
      const model = {
        generate: async () => {
          modelCalls++;
          return {
            model: 'fake',
            content: JSON.stringify({
              operations: [
                {
                  operation: 'upsert',
                  category: 'style',
                  value: { items: ['简约'] },
                  explicit: true,
                },
                {
                  operation: 'upsert',
                  category: 'color',
                  value: { mode: 'prefer', items: ['蓝色'] },
                  explicit: true,
                },
              ],
            }),
          };
        },
      };
      const source = {
        readTurn: async () => ({
          userMessage: '我一直喜欢简约风格和蓝色',
          assistantMessage: '已了解',
        }),
      };
      const extractor = new UserPreferenceExtractorService(
        model,
        em.getRepository(UserPreferenceTask),
        em.getRepository(UserPreference),
        source,
        tasks,
      );
      async function enqueue() {
        await em.fork().transactional((transaction) =>
          tasks.enqueueInTransaction(transaction, {
            userId,
            conversationId: randomUUID(),
            userMessageId: randomUUID(),
            assistantMessageId: randomUUID(),
          }),
        );
      }

      await settings.updateSettings(userId, { enabled: false });
      const reused = em.fork();
      await reused.findOne(UserPreferenceSetting, { userId });
      await settings.updateSettings(userId, { enabled: true });
      await reused.transactional((transaction) =>
        tasks.enqueueInTransaction(transaction, {
          userId,
          conversationId: randomUUID(),
          userMessageId: randomUUID(),
          assistantMessageId: randomUUID(),
        }),
      );
      assert.equal(
        await em.fork().count(UserPreferenceTask, { userId }),
        1,
        '入队持锁后刷新设置，不受外层identity map中旧关闭状态影响',
      );
      await em.fork().nativeDelete(UserPreferenceTask, { userId });

      await enqueue();
      const [left, right] = await Promise.all([
        tasks.claimBatch(),
        tasks.claimBatch(),
      ]);
      assert.equal(left.length + right.length, 1, '竞争领取只产生一个执行租约');
      const oldLease = [...left, ...right][0]!;
      await connection.execute(
        `update user_preference_tasks set locked_at = now() - interval '20 minutes' where id = ?`,
        [oldLease.id],
      );
      assert.equal(await tasks.recoverExpiredProcessing(), 1);
      const [newLease] = await tasks.claimBatch();
      assert.ok(newLease);
      assert.equal(newLease.attempts, 2);
      assert.equal(await tasks.saveCandidate(oldLease, []), null);
      await tasks.markFailed(oldLease, 'OLD_WORKER');
      await tasks.markSucceeded(oldLease);
      assert.equal(
        (await em.fork().findOneOrFail(UserPreferenceTask, { id: oldLease.id }))
          .status,
        'processing',
      );

      const internal = extractor as unknown as {
        applyOperation: (
          task: UserPreferenceTask,
          operation: unknown,
        ) => Promise<void>;
      };
      const apply = internal.applyOperation.bind(extractor);
      let applications = 0;
      internal.applyOperation = async (task, operation) => {
        applications++;
        if (applications === 2) throw new Error('simulated retry');
        await apply(task, operation);
      };
      await assert.rejects(extractor.process(newLease));
      assert.equal(
        await em
          .fork()
          .count(UserPreferenceTaskResult, { taskId: newLease.id }),
        1,
      );
      await tasks.markFailed(newLease, 'SIMULATED_RETRY');
      await connection.execute(
        'update user_preference_tasks set available_at = now() where id = ?',
        [newLease.id],
      );
      const [retry] = await tasks.claimBatch();
      assert.ok(retry);
      internal.applyOperation = apply;
      await extractor.process(retry);
      await tasks.markSucceeded(retry);
      assert.equal(modelCalls, 1, '部分应用重试必须复用持久化候选');
      assert.equal(
        await em.fork().count(UserPreferenceTaskResult, { taskId: retry.id }),
        2,
      );
      assert.equal(
        await em
          .fork()
          .count(UserPreference, { userId, status: 'active' as never }),
        2,
      );
      assert.equal(
        (await em.fork().findOneOrFail(UserPreferenceTask, { id: retry.id }))
          .candidateOperations,
        null,
      );

      await Promise.all([
        settings.getSettings(userId),
        settings.getSettings(userId),
      ]);
      assert.equal(await em.fork().count(UserPreferenceSetting, { userId }), 1);
      await settings.updateSettings(userId, { enabled: false });
      const countBeforeDisabled = await em
        .fork()
        .count(UserPreferenceTask, { userId });
      await enqueue();
      assert.equal(
        await em.fork().count(UserPreferenceTask, { userId }),
        countBeforeDisabled,
      );
      const reader = new UserPreferenceReaderService(
        em.getRepository(UserPreference),
      );
      assert.equal(await reader.readContext(userId, '风格'), '');
      await RequestContext.create(orm.em, () =>
        preferences.create(userId, {
          category: 'fit',
          value: { preference: '宽松' },
          isPrimary: false,
        }),
      );
      await settings.updateSettings(userId, { enabled: true });
      assert.match(await reader.readContext(userId, '风格'), /简约/);

      await enqueue();
      const [inFlight] = await tasks.claimBatch();
      assert.ok(inFlight);
      await tasks.saveCandidate(inFlight, [
        {
          operation: 'upsert',
          category: 'fit',
          value: { preference: '宽松' },
          explicit: true,
        },
      ]);
      await RequestContext.create(orm.em, () => preferences.deleteAll(userId));
      await extractor.process(inFlight);
      await tasks.markSucceeded(inFlight);
      assert.equal(
        await em
          .fork()
          .count(UserPreference, { userId, status: 'active' as never }),
        0,
      );
      assert.equal(
        await em.fork().count(UserPreferenceTask, { id: inFlight.id }),
        0,
      );

      await enqueue();
      let contextSeen = false;
      scheduler = new UserPreferenceSchedulerService(orm, tasks, {
        process: async () => {
          contextSeen = RequestContext.getEntityManager() !== undefined;
          await orm.em.find(UserPreferenceSetting, { userId });
        },
        getFailureCode: () => 'TEST_FAILURE',
      } as never);
      assert.equal(RequestContext.getEntityManager(), undefined);
      await scheduler.poll();
      await scheduler.onModuleDestroy();
      assert.equal(
        contextSeen,
        true,
        '无 HTTP 请求的调度入口创建独立 RequestContext',
      );
      const succeeded = await em.fork().count(UserPreferenceTask, {
        userId,
        status: 'succeeded' as never,
      });
      assert.equal(succeeded, 2);
    } finally {
      await scheduler?.onModuleDestroy();
      await connection.execute(`drop schema if exists "${schema}" cascade`);
      await orm.close(true);
    }
  },
);
