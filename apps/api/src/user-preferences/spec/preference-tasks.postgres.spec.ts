import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '@mikro-orm/core';

import config from '../../mikro-orm.config.js';
import { UserPreference } from '../entity/user-preference.entity.js';
import { UserPreferenceSetting } from '../entity/user-preference-setting.entity.js';
import {
  UserPreferenceTask,
  UserPreferenceTaskStatus,
} from '../entity/user-preference-task.entity.js';
import { UserPreferenceTaskResult } from '../entity/user-preference-task-result.entity.js';
import { UserPreferenceSettingsService } from '../service/user-preference-settings.service.js';
import { UserPreferencesService } from '../service/user-preferences.service.js';

test(
  '删除全部偏好保留所有历史任务及结果',
  {
    skip: process.env.RUN_PERSONALIZATION_POSTGRES_TEST !== '1',
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
    try {
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
      const userId = randomUUID();
      const settings = new UserPreferenceSettingsService(
        em.getRepository(UserPreferenceSetting),
      );
      const preferences = new UserPreferencesService(
        em.getRepository(UserPreference),
        settings,
      );
      const preference = await RequestContext.create(orm.em, () =>
        preferences.create(userId, {
          category: 'style',
          value: { items: ['简约'] },
          isPrimary: false,
        }),
      );
      const tasks = Object.values(UserPreferenceTaskStatus).map((status) =>
        Object.assign(new UserPreferenceTask(), {
          userId,
          status,
          deduplicationKey: randomUUID(),
        }),
      );
      await em.persist(tasks).flush();
      const results = tasks.map((task) =>
        Object.assign(new UserPreferenceTaskResult(), {
          taskId: task.id,
          operationKey: randomUUID(),
          action: 'upsert' as const,
          preferenceId: preference.id,
        }),
      );
      await em.persist(results).flush();

      assert.deepEqual(
        await RequestContext.create(orm.em, () =>
          preferences.deleteAll(userId),
        ),
        { deletedCount: 1 },
      );
      const fresh = orm.em.fork();
      assert.equal(
        await fresh.count(UserPreference, {
          userId,
          status: 'active' as never,
        }),
        0,
      );
      for (const task of tasks) {
        assert.equal(
          (await fresh.findOneOrFail(UserPreferenceTask, { id: task.id }))
            .status,
          task.status,
        );
        assert.equal(
          await fresh.count(UserPreferenceTaskResult, { taskId: task.id }),
          1,
        );
      }
    } finally {
      await connection.execute(`drop schema if exists "${schema}" cascade`);
      await orm.close(true);
    }
  },
);
