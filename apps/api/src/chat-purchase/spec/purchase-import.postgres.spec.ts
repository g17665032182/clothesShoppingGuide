import 'reflect-metadata';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { EntityManager } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';
import { ChatConversationAccess } from '../../chat-records/conversation-access/index.js';
import { ChatConversation } from '../../chat-records/entity/chat-conversation.entity.js';
import { OrderIdempotency } from '../../orders/entity/order-idempotency.entity.js';
import { OrderItem } from '../../orders/entity/order-item.entity.js';
import {
  Order,
  OrderCloseReason,
  OrderStatus,
} from '../../orders/entity/order.entity.js';
import { OrdersService } from '../../orders/service/orders.service.js';
import { OrderCatalogImportService } from '../../order-catalog-coordination/service/order-catalog-import.service.js';
import { Product } from '../../product-catalog/entity/product.entity.js';
import { ProductSku } from '../../product-catalog/entity/product-sku.entity.js';
import { productCatalogImportSchema } from '../../product-catalog/import/product-catalog-import.schema.js';
import { ProductCatalogImportService } from '../../product-catalog/service/product-catalog-import.service.js';
import { ProductCatalogOrderService } from '../../product-catalog/service/product-catalog-order.service.js';
import { ProductCatalogPurchaseService } from '../../product-catalog/service/product-catalog-purchase.service.js';
import { User } from '../../users/entity/user.entity.js';
import { ChatPurchaseDraft } from '../entity/chat-purchase-draft.entity.js';
import { PurchaseConfirmationService } from '../service/purchase-confirmation.service.js';
import { PurchaseDraftService } from '../service/purchase-draft.service.js';
import { PurchaseProjectionService } from '../service/purchase-projection.service.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 仅暂停第一次真实 SKU 加锁，不替代锁、库存、导入或订单业务。 */
class CatalogLockBarrier extends ProductCatalogOrderService {
  public readonly reached = deferred<number>();
  private readonly released = deferred<void>();
  private firstLock = true;

  public constructor(private readonly holdAfterLock: boolean) {
    super();
  }

  public release(): void {
    this.released.resolve();
  }

  public override async lockSkus(em: EntityManager, skuIds: string[]) {
    if (!this.firstLock) return super.lockSkus(em, skuIds);
    this.firstLock = false;
    const [row] = await em
      .getConnection()
      .execute<Array<{ pid: number }>>(
        'select pg_backend_pid() as pid',
        [],
        'all',
        em.getTransactionContext(),
      );
    assert.ok(row);
    if (!this.holdAfterLock) {
      this.reached.resolve(row.pid);
      return super.lockSkus(em, skuIds);
    }
    const snapshots = await super.lockSkus(em, skuIds);
    this.reached.resolve(row.pid);
    await this.released.promise;
    return snapshots;
  }
}

async function entered(
  barrier: CatalogLockBarrier,
  operation: Promise<unknown>,
): Promise<number> {
  return Promise.race([
    barrier.reached.promise,
    operation.then(() => {
      throw new Error('业务操作未到达预期 SKU 锁门闩');
    }),
  ]);
}

async function assertDatabaseBlocked(
  orm: MikroORM,
  holderPid: number,
  waiterPid: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [row] = await orm.em
      .getConnection()
      .execute<Array<{ blocked: boolean }>>(
        'select ?::int = any(pg_blocking_pids(?::int)) as blocked',
        [holderPid, waiterPid],
      );
    if (row?.blocked) return;
    // 等待数据库实际报告锁阻塞，不用固定 sleep 猜测两个事务的先后顺序。
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('未观测到竞争操作等待持有方的 PostgreSQL 锁');
}

async function createFixture(orm: MikroORM) {
  const em = orm.em.fork();
  const owner = Object.assign(new User(), {
    email: `${randomUUID()}@local.invalid`,
    passwordHash: 'non-login-test-fixture',
    displayName: '购买导入并发测试',
  });
  const product = Object.assign(new Product(), {
    externalId: `purchase-import-${randomUUID()}`,
    name: '购买导入并发测试商品',
    category: 'tops',
  });
  em.persist([owner, product]);
  await em.flush();
  const sku = Object.assign(new ProductSku(), {
    productId: product.id,
    externalSkuId: `purchase-import-sku-${randomUUID()}`,
    color: '白色',
    size: 'M',
    price: '39.90',
    stock: 10,
  });
  const conversation = Object.assign(new ChatConversation(), {
    userId: owner.id,
    title: '购买导入并发测试',
  });
  em.persist([sku, conversation]);
  await em.flush();
  const stock = new ProductCatalogOrderService();
  const orders = new OrdersService(em.getRepository(Order), stock);
  const projection = new PurchaseProjectionService();
  const drafts = new PurchaseDraftService(
    em.getRepository(ChatPurchaseDraft),
    new ChatConversationAccess(),
    new ProductCatalogPurchaseService(),
    stock,
    projection,
    orders,
  );
  const started = await drafts.start(owner.id, conversation.id, {
    productExternalId: product.externalId,
    expectedVersion: null,
  });
  const ready = await drafts.patch(
    owner.id,
    conversation.id,
    started.draft.id,
    {
      expectedVersion: started.draft.version,
      quantity: 2,
      recipient: {
        name: '隔离测试收件人',
        phone: '13000000000',
        address: '仅用于自动化测试的虚构地址',
      },
    },
  );
  assert.equal(ready.status, 'ready');

  return {
    owner,
    product,
    sku,
    ready,
    stock,
    orders,
    drafts,
    projection,
    importInput: (active: boolean) =>
      productCatalogImportSchema.parse({
        version: 1,
        products: [
          {
            externalId: product.externalId,
            name: product.name,
            category: product.category,
            isActive: active,
            skus: [
              {
                externalSkuId: sku.externalSkuId,
                color: sku.color,
                size: sku.size,
                price: active ? 49.9 : 39.9,
                stock: active ? 10 : 0,
              },
            ],
          },
        ],
      }).products,
    cleanup: async () => {
      const connection = orm.em.getConnection();
      await connection.execute(
        'delete from chat_conversations where user_id=?',
        [owner.id],
      );
      await connection.execute(
        'delete from order_idempotency where user_id=?',
        [owner.id],
      );
      await connection.execute(
        'delete from order_items where order_id in (select id from orders where user_id=?)',
        [owner.id],
      );
      await connection.execute('delete from orders where user_id=?', [
        owner.id,
      ]);
      await connection.execute('delete from product_skus where product_id=?', [
        product.id,
      ]);
      await connection.execute('delete from products where id=?', [product.id]);
      await connection.execute('delete from users where id=?', [owner.id]);
    },
  };
}

test(
  '隔离 PostgreSQL：聊天确认与真实目录导入双向 SKU 锁竞争',
  {
    skip: process.env.RUN_CHAT_PURCHASE_POSTGRES_TEST !== '1',
    timeout: 120_000,
  },
  async (t) => {
    const dbName = process.env.CHAT_PURCHASE_TEST_DB ?? '';
    assert.match(dbName, /^clothes_guide_chat_purchase_test_[a-z0-9_]+$/u);
    assert.notEqual(dbName, config.dbName);
    const orm = await MikroORM.init({
      ...config,
      dbName,
      debug: false,
      migrations: { ...config.migrations, snapshot: false },
    });
    try {
      await orm.migrator.up();
      await t.test(
        '确认先持 SKU 锁：只创建一单，下架导入随后关闭并释放预占',
        async () => {
          const fixture = await createFixture(orm);
          const holder = new CatalogLockBarrier(true);
          const waiter = new CatalogLockBarrier(false);
          const confirmedOrders = new OrdersService(
            orm.em.getRepository(Order),
            holder,
          );
          const confirmation = new PurchaseConfirmationService(
            fixture.drafts,
            fixture.projection,
            confirmedOrders,
            confirmedOrders,
          );
          const importer = new OrderCatalogImportService(
            orm,
            waiter,
            fixture.orders,
            new ProductCatalogImportService(),
          );
          const pending: Promise<unknown>[] = [];
          try {
            const confirm = confirmation.confirm(
              fixture.owner.id,
              fixture.ready.conversationId,
              fixture.ready.id,
              fixture.ready.version,
            );
            pending.push(confirm);
            const holderPid = await entered(holder, confirm);
            const imported = importer.import(fixture.importInput(false));
            pending.push(imported);
            const waiterPid = await entered(waiter, imported);
            await assertDatabaseBlocked(orm, holderPid, waiterPid);
            holder.release();
            const [result, importResult] = await Promise.all([
              confirm,
              imported,
            ]);
            assert.equal(result.created, true);
            assert.equal(importResult.updated, 1);
            const em = orm.em.fork();
            assert.equal(
              await em.count(Order, { userId: fixture.owner.id }),
              1,
            );
            assert.equal(
              await em.count(OrderIdempotency, { userId: fixture.owner.id }),
              1,
            );
            const order = await em.findOneOrFail(Order, {
              id: result.order.id,
            });
            assert.equal(order.status, OrderStatus.CLOSED);
            assert.equal(
              order.closeReason,
              OrderCloseReason.PRODUCT_UNAVAILABLE,
            );
            assert.ok(order.closedAt);
            const items = await em.find(OrderItem, { orderId: order.id });
            assert.equal(items.length, 1);
            assert.equal(items[0]?.quantity, 2);
            assert.equal(items[0]?.unitPrice, '39.90');
            const draft = await em.findOneOrFail(ChatPurchaseDraft, {
              id: fixture.ready.id,
            });
            assert.equal(draft.status, 'submitted');
            assert.equal(draft.orderId, order.id);
            const reservations = await em.transactional((transaction) =>
              fixture.stock.getReservedQuantities(transaction, [
                fixture.sku.id,
              ]),
            );
            assert.equal(reservations.get(fixture.sku.id) ?? 0, 0);
            assert.equal(
              (await em.findOneOrFail(Product, { id: fixture.product.id }))
                .isActive,
              false,
            );
            assert.equal(
              (await em.findOneOrFail(ProductSku, { id: fixture.sku.id }))
                .stock,
              0,
            );
          } finally {
            holder.release();
            await Promise.allSettled(pending);
            await fixture.cleanup();
          }
        },
      );

      for (const active of [false, true]) {
        await t.test(
          `导入先持 SKU 锁：${active ? '变价' : '下架'}后旧版本确认 409，且无订单残留`,
          async () => {
            const fixture = await createFixture(orm);
            const holder = new CatalogLockBarrier(true);
            const waiter = new CatalogLockBarrier(false);
            const confirmedOrders = new OrdersService(
              orm.em.getRepository(Order),
              waiter,
            );
            const confirmation = new PurchaseConfirmationService(
              fixture.drafts,
              fixture.projection,
              confirmedOrders,
              confirmedOrders,
            );
            const importer = new OrderCatalogImportService(
              orm,
              holder,
              fixture.orders,
              new ProductCatalogImportService(),
            );
            const pending: Promise<unknown>[] = [];
            try {
              const imported = importer.import(fixture.importInput(active));
              pending.push(imported);
              const holderPid = await entered(holder, imported);
              const confirm = confirmation.confirm(
                fixture.owner.id,
                fixture.ready.conversationId,
                fixture.ready.id,
                fixture.ready.version,
              );
              pending.push(confirm);
              const rejected = assert.rejects(confirm, { status: 409 });
              const waiterPid = await entered(waiter, confirm);
              await assertDatabaseBlocked(orm, holderPid, waiterPid);
              holder.release();
              await Promise.all([imported, rejected]);
              const em = orm.em.fork();
              assert.equal(
                await em.count(Order, { userId: fixture.owner.id }),
                0,
              );
              assert.equal(
                await em.count(OrderIdempotency, { userId: fixture.owner.id }),
                0,
              );
              assert.equal(
                await em.count(OrderItem, { skuId: fixture.sku.id }),
                0,
              );
              const reservations = await em.transactional((transaction) =>
                fixture.stock.getReservedQuantities(transaction, [
                  fixture.sku.id,
                ]),
              );
              assert.equal(reservations.get(fixture.sku.id) ?? 0, 0);
              const draft = await em.findOneOrFail(ChatPurchaseDraft, {
                id: fixture.ready.id,
              });
              assert.equal(draft.orderId, null);
              assert.ok(draft.version > fixture.ready.version);
              if (active) {
                assert.equal(draft.confirmation?.unitPrice, '49.90');
                assert.ok(
                  draft.issues.some((issue) => issue.code === 'price_changed'),
                );
              } else {
                assert.equal(draft.confirmation, null);
                assert.ok(
                  draft.issues.some(
                    (issue) => issue.code === 'product_unavailable',
                  ),
                );
              }
            } finally {
              holder.release();
              await Promise.allSettled(pending);
              await fixture.cleanup();
            }
          },
        );
      }
    } finally {
      await orm.close(true);
    }
  },
);
