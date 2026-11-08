import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../../mikro-orm.config.js';

test(
  '购买增量迁移：旧消息默认兼容、外键方向、唯一约束和回滚保留正式订单',
  {
    skip: process.env.RUN_CHAT_PURCHASE_POSTGRES_TEST !== '1',
    timeout: 60_000,
  },
  async () => {
    const dbName = `${process.env.CHAT_PURCHASE_TEST_DB ?? ''}_migration`;
    assert.match(
      dbName,
      /^clothes_guide_chat_purchase_test_[a-z0-9_]+_migration$/u,
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
      assert.equal(
        tables[0]?.count,
        '0',
        '迁移升级测试必须使用空的可销毁测试库',
      );
      await orm.migrator.up({ to: 'Migration20261107100000' });
      const userId = randomUUID(),
        conversationId = randomUUID(),
        messageId = randomUUID(),
        draftId = randomUUID(),
        productId = randomUUID(),
        firstSkuId = randomUUID(),
        secondSkuId = randomUUID(),
        orderId = randomUUID(),
        idempotencyId = randomUUID();
      await connection.execute(
        `insert into users(id,email,password_hash,display_name,role,status,created_at,updated_at)
      values (?,?,'fixture','迁移测试','user','active',now(),now())`,
        [userId, `${userId}@local.invalid`],
      );
      await connection.execute(
        `insert into chat_conversations(id,user_id,title,created_at,updated_at)
      values (?,?,'旧会话',now(),now())`,
        [conversationId, userId],
      );
      await connection.execute(
        `insert into chat_messages(id,conversation_id,role,content,created_at)
      values (?,?,'user','旧消息',now())`,
        [messageId, conversationId],
      );
      await connection.execute(
        `insert into products(id,external_id,name,category,created_at,updated_at)
      values (?,'migration-legacy-product','迁移测试旧商品','tops',now(),now())`,
        [productId],
      );
      await connection.execute(
        `insert into product_skus
      (id,product_id,external_sku_id,color,size,price,stock,created_at,updated_at)
      values (?,?,'legacy-first','黑色','M',19.90,10,now(),now()),
        (?,?,'legacy-second','白色','L',35.00,10,now(),now())`,
        [firstSkuId, productId, secondSkuId, productId],
      );
      await connection.execute(
        `insert into orders
      (id,order_no,user_id,status,items_amount,payable_amount,
        recipient_name,recipient_phone,recipient_address,expires_at)
      values (?,'MIGRATION-LEGACY-ORDER',?,'pending_payment',74.80,74.80,
        '迁移测试收件人','13000000000','仅用于隔离迁移测试的虚构地址',
        now()+interval '30 minutes')`,
        [orderId, userId],
      );
      await connection.execute(
        `insert into order_items
      (id,order_id,sku_id,product_external_id,product_name,color,size,unit_price,quantity,line_amount)
      values (?,?,?,'migration-legacy-product','旧商品快照','黑色','M',19.90,2,39.80),
        (?,?,?,'migration-legacy-product','旧商品快照','白色','L',35.00,1,35.00)`,
        [randomUUID(), orderId, firstSkuId, randomUUID(), orderId, secondSkuId],
      );
      await connection.execute(
        `insert into order_idempotency
      (id,user_id,idempotency_key,request_hash,order_id)
      values (?,?,?,?,?)`,
        [idempotencyId, userId, randomUUID(), 'a'.repeat(64), orderId],
      );
      // 比对完整旧记录而非只判断表存在，防止金额、快照或幂等关联被迁移悄然改写。
      const readLegacyOrder = async () => ({
        orders: await connection.execute<Array<Record<string, unknown>>>(
          'select * from orders where id=?',
          [orderId],
        ),
        items: await connection.execute<Array<Record<string, unknown>>>(
          'select * from order_items where order_id=? order by id',
          [orderId],
        ),
        idempotency: await connection.execute<Array<Record<string, unknown>>>(
          'select * from order_idempotency where id=?',
          [idempotencyId],
        ),
      });
      const legacyOrder = await readLegacyOrder();
      assert.equal(legacyOrder.orders.length, 1);
      assert.equal(legacyOrder.items.length, 2);
      assert.equal(legacyOrder.idempotency.length, 1);
      await orm.migrator.up();
      assert.deepEqual(
        await readLegacyOrder(),
        legacyOrder,
        '升级保留完整旧订单',
      );
      const [old] = await connection.execute<
        Array<{ memory_extraction_eligible: boolean }>
      >('select memory_extraction_eligible from chat_messages where id=?', [
        messageId,
      ]);
      assert.equal(old?.memory_extraction_eligible, true);
      const insert = (id: string) =>
        connection.execute(
          `insert into chat_purchase_drafts
      (id,user_id,conversation_id,product_external_id,quantity,status,version,issues,submission_key,created_at,updated_at,expires_at)
      values (?,?,?,'fixture',1,'collecting',1,'[]',?,now(),now(),now()+interval '24 hours')`,
          [id, userId, conversationId, randomUUID()],
        );
      await insert(draftId);
      await assert.rejects(insert(randomUUID()), /unique|duplicate/u);
      await assert.rejects(
        connection.execute(
          'update chat_purchase_drafts set quantity=100 where id=?',
          [draftId],
        ),
        /check/u,
      );
      await assert.rejects(
        connection.execute(
          "update chat_purchase_drafts set status='submitted' where id=?",
          [draftId],
        ),
        /check/u,
      );
      const fks = await connection.execute<Array<{ definition: string }>>(
        "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='chat_purchase_drafts'::regclass and contype='f'",
      );
      assert.ok(
        fks.some((fk) =>
          /REFERENCES orders.*ON DELETE RESTRICT/u.test(fk.definition),
        ),
      );
      assert.ok(
        fks.some((fk) =>
          /REFERENCES chat_conversations.*ON DELETE CASCADE/u.test(
            fk.definition,
          ),
        ),
      );
      await connection.execute(
        `update chat_purchase_drafts
      set status='submitted',order_id=?,submitted_version=1 where id=?`,
        [orderId, draftId],
      );
      await connection.execute('delete from chat_conversations where id=?', [
        conversationId,
      ]);
      const [remaining] = await connection.execute<Array<{ count: string }>>(
        'select count(*)::text from chat_purchase_drafts',
      );
      assert.equal(remaining?.count, '0');
      assert.deepEqual(
        await readLegacyOrder(),
        legacyOrder,
        '删除已关联草稿的会话不级联删除正式订单、明细和幂等数据',
      );
      await orm.migrator.down({ to: 'Migration20261107100000' });
      const [retained] = await connection.execute<
        Array<{ orders: string; idempotency: string; drafts: null }>
      >(
        "select to_regclass('orders')::text orders, to_regclass('order_idempotency')::text idempotency,to_regclass('chat_purchase_drafts')::text drafts",
      );
      assert.equal(retained?.orders, 'orders');
      assert.equal(retained?.idempotency, 'order_idempotency');
      assert.equal(retained?.drafts, null);
      assert.deepEqual(
        await readLegacyOrder(),
        legacyOrder,
        '回滚保留完整旧订单',
      );
      await orm.migrator.up();
      assert.deepEqual(
        await readLegacyOrder(),
        legacyOrder,
        '再次升级仍保留旧订单、明细和幂等数据',
      );
    } finally {
      await orm.close();
    }
  },
);
