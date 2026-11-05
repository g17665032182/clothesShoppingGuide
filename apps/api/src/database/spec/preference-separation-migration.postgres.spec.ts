import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { compare } from 'bcryptjs';
import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';
import { User } from '../../users/entity/user.entity.js';
import { Migration20261026182521 } from '../migrations/Migration20261026182521.js';
import { Migration20261027090000 } from '../migrations/Migration20261027090000.js';
import { Migration20261028100000 } from '../migrations/Migration20261028100000.js';
import { Migration20261029150000 } from '../migrations/Migration20261029150000.js';
import { Migration20261103120000 } from '../migrations/Migration20261103120000.js';
import { Migration20261103130000 } from '../migrations/Migration20261103130000.js';
import { Migration20261104090000 } from '../migrations/Migration20261104090000.js';
import { Migration20261105100000 } from '../migrations/Migration20261105100000.js';
import { DatabaseSeeder } from '../seeders/DatabaseSeeder.js';

test(
  '专用 PostgreSQL：旧数据拆分、危险任务回滚、索引外键和 Seed 幂等',
  {
    skip: process.env.RUN_SEPARATION_MIGRATION_TEST !== '1',
    timeout: 60_000,
  },
  async (t) => {
    const dbName = process.env.PERSONALIZATION_TEST_DB ?? '';
    assert.match(dbName, /^clothes_guide_separation_test_[a-z0-9_]+$/u);
    assert.notEqual(dbName, config.dbName);
    const orm = await MikroORM.init({
      ...config,
      dbName,
      entities: [User],
      entitiesTs: [User],
      debug: false,
      migrations: {
        ...config.migrations,
        snapshot: false,
        migrationsList: [
          Migration20261026182521,
          Migration20261027090000,
          Migration20261028100000,
          Migration20261029150000,
          Migration20261103120000,
          Migration20261103130000,
          Migration20261104090000,
          Migration20261105100000,
        ],
      },
    });
    const connection = orm.em.getConnection();
    const userIds = [randomUUID(), randomUUID(), randomUUID()];
    const taskIds = Array.from({ length: 8 }, () => randomUUID());
    const preferenceId = randomUUID();
    const timestamp = new Date('2026-11-01T00:00:00.000Z');
    try {
      const existing = await connection.execute<Array<{ count: string }>>(
        "select count(*) from pg_tables where schemaname = 'public'",
      );
      assert.equal(Number(existing[0]?.count), 0, '仅在全新专用测试库运行');
      const migrator = orm.migrator;
      await migrator.up({ to: 'Migration20261103130000' });
      for (const id of userIds) {
        await connection.execute(
          `insert into users (id,email,password_hash,display_name,role,status,created_at,updated_at)
           values (?, ?, 'fixture-no-login', 'migration fixture', 'user', 'active', ?, ?)`,
          [id, `${id}@local.invalid`, timestamp, timestamp],
        );
      }
      for (const [index, id] of userIds.slice(0, 2).entries()) {
        await connection.execute(
          'insert into user_memory_settings values (?, ?, ?, ?)',
          [id, index === 0, timestamp, timestamp],
        );
      }
      await connection.execute(
        `insert into user_memories (
          id,user_id,category,value_type,value,value_fingerprint,is_primary,status,
          source_conversation_id,source_status,deleted_at,created_at,updated_at
         ) values (?, ?, 'style', 'multi', ?, ?, true, 'active', null, null, null, ?, ?)`,
        [
          preferenceId,
          userIds[0],
          JSON.stringify({ items: ['casual'] }),
          createHash('sha256').update('fixture').digest('hex'),
          timestamp,
          timestamp,
        ],
      );
      const states = [
        ['pending', 0],
        ['failed', 2],
        ['processing', 2],
        ['processing', 4],
        ['succeeded', 1],
        ['failed', 4],
        ['pending', 1],
        ['failed', 1],
      ] as const;
      for (const [index, id] of taskIds.entries()) {
        const [status, attempts] = states[index]!;
        await connection.execute(
          `insert into user_memory_tasks (
            id,user_id,deduplication_key,status,attempts,available_at,locked_at,
            created_at,updated_at,document_generation
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 7)`,
          [
            id,
            userIds[0],
            `migration:${id}`,
            status,
            attempts,
            timestamp,
            status === 'processing' ? timestamp : null,
            timestamp,
            timestamp,
          ],
        );
      }
      await connection.execute(
        `insert into user_memory_document_states
         values (?, 3, 'retained-private-object', 7, ?, ?)`,
        [userIds[0], 'a'.repeat(64), timestamp],
      );
      for (const index of [4, 5, 6]) {
        await connection.execute(
          'insert into user_memory_task_results values (?, ?, ?, ?, ?, ?)',
          [
            randomUUID(),
            taskIds[index],
            `retained-operation-${index}`,
            'upsert',
            preferenceId,
            timestamp,
          ],
        );
      }
      for (const index of [4, 7]) {
        await connection.execute(
          'insert into user_memory_document_task_results values (?, ?, ?, ?)',
          [
            randomUUID(),
            taskIds[index],
            `retained-document-operation-${index}`,
            timestamp,
          ],
        );
      }

      for (const table of [
        'user_memory_task_results',
        'user_memory_document_task_results',
      ]) {
        await assert.rejects(
          migrator.up(),
          /LEGACY_PARTIAL_TASKS_MUST_BE_DRAINED/u,
        );
        const [tables] = await connection.execute<
          Array<{ old_table: string | null; new_table: string | null }>
        >(
          "select to_regclass('user_memories')::text old_table, to_regclass('user_preferences')::text new_table",
        );
        assert.equal(tables?.old_table, 'user_memories');
        assert.equal(tables?.new_table, null);
        // 模拟旧 worker 已完成指定任务，保留其结果，随后再尝试升级。
        const index = table === 'user_memory_task_results' ? 6 : 7;
        await connection.execute(
          "update user_memory_tasks set status = 'succeeded' where id = ?",
          [taskIds[index]],
        );
      }
      t.diagnostic('两类旧部分成功任务均阻断迁移，数据库无半改名状态');
      await migrator.up();
      const legacyTask = await connection.execute<
        Array<{ source_turns: unknown }>
      >('select source_turns from user_memory_tasks where id = ?', [
        taskIds[0],
      ]);
      assert.equal(legacyTask[0]?.source_turns, null);
      await connection.execute(
        `update user_memory_tasks set source_turns = ?::jsonb where id = ?`,
        [
          JSON.stringify([
            {
              userMessageId: randomUUID(),
              assistantMessageId: randomUUID(),
            },
            {
              userMessageId: randomUUID(),
              assistantMessageId: randomUUID(),
            },
          ]),
          taskIds[0],
        ],
      );
      await assert.rejects(
        migrator.down({ to: 'Migration20261104090000' }),
        /ACTIVE_MEMORY_BATCHES_REQUIRE_FORWARD_MIGRATION/u,
      );
      await connection.execute(
        `update user_memory_tasks set source_turns = jsonb_build_array(source_turns -> 0)
         where id = ?`,
        [taskIds[0]],
      );
      const preferences = await connection.execute<
        Array<{ id: string; user_id: string; value: unknown; created_at: Date }>
      >('select * from user_preferences');
      assert.equal(preferences[0]?.id, preferenceId);
      assert.equal(preferences[0]?.user_id, userIds[0]);
      assert.deepEqual(preferences[0]?.value, { items: ['casual'] });
      assert.equal(
        new Date(preferences[0]!.created_at).toISOString(),
        timestamp.toISOString(),
      );
      const settings = await connection.execute<
        Array<{ user_id: string; enabled: boolean; updated_at: Date }>
      >('select * from user_preference_settings order by user_id');
      assert.equal(settings.length, 2);
      assert.equal(
        settings.find((row) => row.user_id === userIds[1])?.enabled,
        false,
      );
      assert.equal(
        settings.some((row) => row.user_id === userIds[2]),
        false,
      );
      const tasks = await connection.execute<
        Array<{
          id: string;
          status: string;
          attempts: number;
          locked_at: Date | null;
          candidate_operations: unknown;
        }>
      >('select * from user_preference_tasks');
      assert.deepEqual(new Set(tasks.map((row) => row.id)), new Set(taskIds));
      assert.equal(
        tasks.find((row) => row.id === taskIds[2])?.status,
        'pending',
      );
      assert.equal(
        tasks.find((row) => row.id === taskIds[3])?.status,
        'failed',
      );
      assert.equal(tasks.find((row) => row.id === taskIds[3])?.attempts, 4);
      assert.equal(
        tasks.every((row) => row.locked_at === null),
        true,
      );
      assert.equal(
        tasks.every((row) => row.candidate_operations === null),
        true,
      );
      const [result] = await connection.execute<
        Array<{ task_id: string; preference_id: string; operation_key: string }>
      >('select * from user_preference_task_results where task_id = ?', [
        taskIds[4],
      ]);
      assert.equal(result?.preference_id, preferenceId);
      assert.equal(result?.operation_key, 'retained-operation-4');
      const [document] = await connection.execute<
        Array<{
          object_key: string;
          document_generation: number;
          revision: number;
        }>
      >('select * from user_memory_document_states where user_id = ?', [
        userIds[0],
      ]);
      assert.equal(document?.object_key, 'retained-private-object');
      assert.equal(document?.document_generation, 7);
      assert.equal(document?.revision, 3);
      const foreignKeys = await connection.execute<
        Array<{ definition: string }>
      >(
        `select pg_get_constraintdef(oid) definition from pg_constraint
         where conrelid = 'user_preference_task_results'::regclass and contype = 'f'`,
      );
      assert.equal(
        foreignKeys.some((row) =>
          row.definition.includes('REFERENCES user_preference_tasks(id)'),
        ),
        true,
      );
      const indexes = await connection.execute<
        Array<{ indexname: string; indexdef: string }>
      >(
        "select indexname,indexdef from pg_indexes where tablename = 'user_preferences'",
      );
      assert.equal(
        indexes.some(
          (row) =>
            row.indexname ===
              'user_preferences_user_category_fingerprint_active_unique' &&
            row.indexdef.includes("WHERE (status = 'active'::text)"),
        ),
        true,
      );
      await assert.rejects(
        migrator.down({ to: 'Migration20261103130000' }),
        /SEPARATION_REQUIRES_CONSISTENT_BACKUP_RESTORE/u,
      );
      assert.equal(
        (await migrator.getExecuted()).at(-1)?.name,
        'Migration20261105100000',
      );
      t.diagnostic(
        'ID、设置、generation、文档指针、操作键、任务次数和外键保留；有损 down 被拒绝',
      );

      await orm.seeder.seed(DatabaseSeeder);
      const admin = await orm.em.fork().findOneOrFail(User, {
        email: (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com')
          .trim()
          .toLowerCase(),
      });
      assert.equal(admin.role, 'admin');
      assert.equal(
        await compare(
          process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
          admin.passwordHash,
        ),
        true,
      );
      const originalHash = admin.passwordHash;
      await orm.seeder.seed(DatabaseSeeder);
      const repeated = await orm.em
        .fork()
        .findOneOrFail(User, { id: admin.id });
      assert.equal(repeated.passwordHash === originalHash, true);
      t.diagnostic('Seed 创建配置管理员且重复运行保持已有密码');
    } finally {
      try {
        const [table] = await connection.execute<
          Array<{ name: string | null }>
        >("select to_regclass('users')::text name");
        if (table?.name) {
          await connection.execute(
            'delete from users where id in (?, ?, ?)',
            userIds,
          );
        }
      } finally {
        await orm.close();
      }
    }
  },
);
