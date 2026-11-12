import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';

test(
  '商品试穿迁移：历史记录保留、新旧默认关闭及非空约束',
  {
    skip: process.env.RUN_PRODUCT_TRY_ON_POSTGRES_TEST !== '1',
    timeout: 60_000,
  },
  async (t) => {
    const dbName = process.env.PRODUCT_TRY_ON_TEST_DB ?? '';
    assert.match(
      dbName,
      /^clothes_guide_product_tryon_test_[a-z0-9_]+_migration$/u,
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
      assert.equal(tables[0]?.count, '0', '仅允许在空的可销毁测试库验证升级');
      await orm.migrator.up({ to: 'Migration20261109120000' });

      const userId = randomUUID();
      const productId = randomUUID();
      const skuId = randomUUID();
      const orderId = randomUUID();
      const taskId = randomUUID();
      await connection.execute(
        `insert into users
          (id,email,password_hash,display_name,role,status,created_at,updated_at)
         values (?,?,'fixture','试穿迁移测试','user','active',now(),now())`,
        [userId, `${userId}@local.invalid`],
      );
      await connection.execute(
        `insert into products
          (id,external_id,name,category,is_active,created_at,updated_at)
         values (?,'tryon-legacy-product','历史服装','tops',true,now(),now())`,
        [productId],
      );
      await connection.execute(
        `insert into product_skus
          (id,product_id,external_sku_id,color,size,price,currency,stock,
           image_url,is_active,created_at,updated_at)
         values (?,?,'tryon-legacy-sku','白色','M',29.90,'CNY',8,
           'https://images.unsplash.com/tryon-fixture.jpg',true,now(),now())`,
        [skuId, productId],
      );
      await connection.execute(
        `insert into orders
          (id,order_no,user_id,status,items_amount,payable_amount,
           recipient_name,recipient_phone,recipient_address,expires_at)
         values (?,'TRYON-MIGRATION-ORDER',?,'pending_payment',59.80,59.80,
           '迁移测试','13800138000','隔离库测试地址',now()+interval '30 minutes')`,
        [orderId, userId],
      );
      await connection.execute(
        `insert into order_items
          (id,order_id,sku_id,product_external_id,product_name,color,size,
           unit_price,quantity,line_amount)
         values (?,?,?,'tryon-legacy-product','历史服装','白色','M',29.90,2,59.80)`,
        [randomUUID(), orderId, skuId],
      );
      await connection.execute(
        `insert into try_on_tasks
          (id,user_id,status,product_external_id,product_name,product_category,
           color,consent_version,consented_at,available_at,created_at,updated_at)
         values (?,?,'queued','tryon-legacy-product','历史服装','tops',
           '白色','v1',now(),now(),now(),now())`,
        [taskId, userId],
      );

      const readLegacy = async () => ({
        products: await connection.execute(
          'select id,external_id,name,category,is_active,created_at,updated_at from products',
        ),
        skus: await connection.execute('select * from product_skus'),
        users: await connection.execute('select * from users'),
        orders: await connection.execute('select * from orders'),
        items: await connection.execute('select * from order_items'),
        reservations: await connection.execute(
          'select * from active_order_sku_reservations',
        ),
        tasks: await connection.execute(
          `select id,user_id,status,product_external_id,product_name,
                  product_category,color,garment_image_url,source_photo_id,
                  consent_version,consented_at,attempts,available_at,locked_at,
                  failure_code,provider_model,provider_request_id,
                  notification_read_at,created_at,updated_at,completed_at,deleted_at
             from try_on_tasks`,
        ),
      });
      const before = await readLegacy();
      const oldMigrations = await orm.migrator.getExecuted();
      await orm.migrator.up();
      const addedMigrations = (await orm.migrator.getExecuted())
        .slice(oldMigrations.length)
        .map((migration) => migration.name);
      assert.deepEqual(
        addedMigrations,
        [
          'Migration20261109130000',
          'Migration20261109184000',
          'Migration20261110120000',
        ],
        '商品开关、图片快照和地址簿迁移均应按版本顺序应用',
      );
      assert.deepEqual(await readLegacy(), before, '升级不得改写既有业务记录');
      const [legacy] = await connection.execute<
        Array<{ try_on_enabled: boolean }>
      >('select try_on_enabled from products where id=?', [productId]);
      assert.equal(legacy?.try_on_enabled, false);
      const [legacyImage] = await connection.execute<
        Array<{ try_on_image_key: string | null }>
      >('select try_on_image_key from products where id=?', [productId]);
      assert.equal(legacyImage?.try_on_image_key, null);
      const [legacyTask] = await connection.execute<
        Array<{ garment_image_object_key: string | null }>
      >('select garment_image_object_key from try_on_tasks where id=?', [
        taskId,
      ]);
      assert.equal(legacyTask?.garment_image_object_key, null);

      const newProductId = randomUUID();
      await connection.execute(
        `insert into products (id,external_id,name,category,created_at,updated_at)
         values (?,'tryon-new-product','新增服装','tops',now(),now())`,
        [newProductId],
      );
      const [added] = await connection.execute<
        Array<{ try_on_enabled: boolean }>
      >('select try_on_enabled from products where id=?', [newProductId]);
      assert.equal(added?.try_on_enabled, false);
      await assert.rejects(
        connection.execute(
          'update products set try_on_enabled=null where id=?',
          [newProductId],
        ),
        /not-null|null value/iu,
      );
      t.diagnostic(
        '既有用户、商品、SKU、库存预占、订单和已接受试穿任务全部保留',
      );
    } finally {
      // 测试只关闭自己的连接；创建并销毁隔离数据库由外部验证流程负责。
      await orm.close(true);
    }
  },
);
