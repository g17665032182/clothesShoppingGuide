import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';

test(
  '收货地址迁移：约束幂等键和默认地址，回滚不改动旧订单',
  {
    skip: process.env.RUN_USER_ADDRESSES_POSTGRES_TEST !== '1',
    timeout: 60_000,
  },
  async () => {
    const dbName = process.env.USER_ADDRESSES_TEST_DB ?? '';
    assert.match(
      dbName,
      /^clothes_guide_user_addresses_test_[a-z0-9_]+_migration$/u,
    );
    assert.notEqual(dbName, config.dbName);
    const orm = await MikroORM.init({
      ...config,
      dbName,
      debug: false,
      migrations: { ...config.migrations, snapshot: false },
    });
    try {
      const connection = orm.em.getConnection();
      const tables = await connection.execute<Array<{ count: string }>>(
        "select count(*)::text from pg_tables where schemaname='public'",
      );
      assert.equal(tables[0]?.count, '0', '迁移验证必须使用空的可销毁测试库');
      await orm.migrator.up({ to: 'Migration20261109184000' });
      const userId = randomUUID();
      const otherUserId = randomUUID();
      await connection.execute(
        `insert into users
          (id,email,password_hash,display_name,role,status,created_at,updated_at)
         values (?,?,'fixture','地址迁移测试','user','active',now(),now()),
                (?,?,'fixture','地址迁移测试二','user','active',now(),now())`,
        [
          userId,
          `${userId}@local.invalid`,
          otherUserId,
          `${otherUserId}@local.invalid`,
        ],
      );
      await orm.migrator.up();
      const key = randomUUID();
      const firstAddressId = randomUUID();
      await connection.execute(
        `insert into user_addresses
          (id,user_id,recipient_name,phone,address,create_request_key,
           is_default,created_at,updated_at)
         values (?,?,'测试一','13800138000','虚构地址一',?,true,now(),now())`,
        [firstAddressId, userId, key],
      );
      await assert.rejects(
        connection.execute(
          `insert into user_addresses
            (id,user_id,recipient_name,phone,address,create_request_key,
             is_default,created_at,updated_at)
           values (?,?,'测试二','13800138001','虚构地址二',?,false,now(),now())`,
          [randomUUID(), userId, key],
        ),
        /unique|duplicate/u,
      );
      await assert.rejects(
        connection.execute(
          `insert into user_addresses
            (id,user_id,recipient_name,phone,address,create_request_key,
             is_default,created_at,updated_at)
           values (?,?,'测试二','13800138001','虚构地址二',?,true,now(),now())`,
          [randomUUID(), userId, randomUUID()],
        ),
        /unique|duplicate/u,
      );
      await assert.rejects(
        connection.execute(
          `insert into user_addresses
            (id,user_id,recipient_name,phone,address,create_request_key,
             is_default,created_at,updated_at)
           values (?,?,'他人地址','13800138002','虚构地址三',?,false,now(),now())`,
          [randomUUID(), randomUUID(), randomUUID()],
        ),
        /foreign key/u,
      );
      const addresses = await connection.execute(
        'select id,user_id,create_request_key,is_default from user_addresses',
      );
      await orm.migrator.down({ to: 'Migration20261109184000' });
      const [table] = await connection.execute<
        Array<{ relation: string | null }>
      >("select to_regclass('user_addresses')::text as relation");
      assert.equal(table?.relation, null);
      assert.equal(addresses.length, 1);
    } finally {
      await orm.close(true);
    }
  },
);
