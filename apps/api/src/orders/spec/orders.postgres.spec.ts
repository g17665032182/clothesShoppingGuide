import 'reflect-metadata';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { ConflictException } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';
import { User } from '../../users/entity/user.entity.js';
import { Product } from '../../product-catalog/entity/product.entity.js';
import { ProductSku } from '../../product-catalog/entity/product-sku.entity.js';
import { ProductCatalogOrderService } from '../../product-catalog/service/product-catalog-order.service.js';
import { createOrderSchema } from '../dto/create-order.dto.js';
import { shipOrderSchema } from '../dto/ship-order.dto.js';
import { Order, OrderStatus } from '../entity/order.entity.js';
import { OrderIdempotency } from '../entity/order-idempotency.entity.js';
import { OrderItem } from '../entity/order-item.entity.js';
import { OrdersService } from '../service/orders.service.js';
import type {
  ConfirmedOrderInput,
  ConfirmedOrderSnapshot,
} from '../port/order-confirmed-creation.port.js';

const ownerId = randomUUID();
const otherOwnerId = randomUUID();
const secondOwnerId = randomUUID();
const productId = randomUUID();
const skuId = randomUUID();
const secondSkuId = randomUUID();

test(
  '专用 PostgreSQL：并发下单不超卖、幂等重试不重复预占',
  {
    skip: process.env.RUN_ORDERS_POSTGRES_TEST !== '1',
    timeout: 60_000,
  },
  async (t) => {
    const dbName = process.env.ORDERS_TEST_DB ?? '';
    assert.match(dbName, /^clothes_guide_orders_test_[a-z0-9_]+$/u);
    assert.notEqual(dbName, config.dbName);

    const entities = [
      User,
      Product,
      ProductSku,
      Order,
      OrderItem,
      OrderIdempotency,
    ];
    const orm = await MikroORM.init({
      ...config,
      dbName,
      entities,
      entitiesTs: entities,
      allowGlobalContext: false,
      debug: false,
    });
    const connection = orm.em.getConnection();
    let migrated = false;

    try {
      await orm.migrator.up();
      migrated = true;

      const setup = orm.em.fork();
      setup.persist(
        Object.assign(new User(), {
          id: ownerId,
          email: `orders-test-${ownerId}@local.invalid`,
          passwordHash: 'non-login-test-fixture',
          displayName: '订单并发测试用户',
        }),
      );
      setup.persist(
        Object.assign(new User(), {
          id: otherOwnerId,
          email: `orders-test-${otherOwnerId}@local.invalid`,
          passwordHash: 'non-login-test-fixture',
          displayName: '订单并发测试用户二',
        }),
      );
      setup.persist(
        Object.assign(new User(), {
          id: secondOwnerId,
          email: `orders-test-${secondOwnerId}@local.invalid`,
          passwordHash: 'non-login-test-fixture',
          displayName: '订单并发测试用户三',
        }),
      );
      setup.persist(
        Object.assign(new Product(), {
          id: productId,
          externalId: `orders-test-${productId}`,
          name: '并发测试大衣',
          category: 'outerwear',
          isActive: true,
        }),
      );
      await setup.flush();
      setup.persist(
        Object.assign(new ProductSku(), {
          id: skuId,
          productId,
          externalSkuId: `orders-test-sku-${skuId}`,
          color: '黑色',
          size: 'M',
          price: '899.00',
          currency: 'CNY',
          stock: 1,
          isActive: true,
        }),
      );
      setup.persist(
        Object.assign(new ProductSku(), {
          id: secondSkuId,
          productId,
          externalSkuId: `orders-test-sku-${secondSkuId}`,
          color: '深蓝',
          size: 'L',
          price: '499.00',
          currency: 'CNY',
          stock: 4,
          isActive: true,
        }),
      );
      await setup.flush();

      const service = new OrdersService(
        orm.em.getRepository(Order),
        new ProductCatalogOrderService(),
      );
      const idempotencyKey = randomUUID();
      const firstInput = createOrderSchema.parse({
        idempotencyKey,
        items: [{ skuId, quantity: 1 }],
        recipient: {
          name: '测试收件人',
          phone: '13800138000',
          address: '隔离测试地址',
        },
      });
      const retryInput = createOrderSchema.parse({
        idempotencyKey,
        items: [{ skuId, quantity: 1 }],
        recipient: {
          name: ' 测试收件人 ',
          phone: '13800138000',
          address: ' 隔离测试地址 ',
        },
      });

      const sameRequest = await Promise.all([
        service.createForUser(ownerId, firstInput),
        service.createForUser(ownerId, retryInput),
      ]);
      assert.equal(sameRequest.filter((result) => result.created).length, 1);
      assert.equal(sameRequest[0]?.order.id, sameRequest[1]?.order.id);

      const competingInputs = [otherOwnerId, secondOwnerId].map((userId) =>
        service.createForUser(
          userId,
          createOrderSchema.parse({
            idempotencyKey: randomUUID(),
            items: [{ skuId, quantity: 1 }],
            recipient: {
              name: '测试收件人',
              phone: '13800138000',
              address: '隔离测试地址',
            },
          }),
        ),
      );
      const competing = await Promise.allSettled(competingInputs);
      assert.equal(
        competing.filter((result) => result.status === 'fulfilled').length,
        0,
        '已被首单占用的唯一库存不能被其他买家重复下单',
      );
      assert.ok(
        competing.every(
          (result) =>
            result.status === 'rejected' &&
            result.reason instanceof ConflictException,
        ),
      );

      const reserved = await orm.em
        .fork()
        .transactional((transaction) =>
          new ProductCatalogOrderService().getReservedQuantities(transaction, [
            skuId,
          ]),
        );
      assert.equal(reserved.get(skuId), 1);

      const lifecycleOrder = await service.createForUser(
        ownerId,
        createOrderSchema.parse({
          idempotencyKey: randomUUID(),
          items: [{ skuId: secondSkuId, quantity: 2 }],
          recipient: {
            name: '履约测试收件人',
            phone: '13800138000',
            address: '履约测试快照地址',
          },
        }),
      );
      const lifecycleOrderId = lifecycleOrder.order.id;
      assert.equal(lifecycleOrder.order.status, OrderStatus.PENDING_PAYMENT);
      assert.equal(lifecycleOrder.order.itemsAmount, '998.00');
      const ownerCandidates = await service.listCancelableForUser(ownerId);
      assert.ok(ownerCandidates.some(({ id }) => id === lifecycleOrderId));
      assert.ok(
        ownerCandidates.every(
          ({ status }) => status === OrderStatus.PENDING_PAYMENT,
        ),
      );
      assert.ok(ownerCandidates.length <= 5);
      assert.equal(
        (await service.listCancelableForUser(otherOwnerId)).some(
          ({ id }) => id === lifecycleOrderId,
        ),
        false,
      );
      const expiryEm = orm.em.fork();
      const expiryOrder = await expiryEm.findOneOrFail(Order, {
        id: lifecycleOrderId,
        userId: ownerId,
      });
      expiryOrder.expiresAt = new Date('2000-01-01T00:00:00.000Z');
      await expiryEm.flush();
      assert.equal(
        (await service.listCancelableForUser(ownerId)).some(
          ({ id }) => id === lifecycleOrderId,
        ),
        false,
        '数据库时钟查询必须排除已过期但尚未由轮询关闭的订单',
      );
      expiryOrder.expiresAt = new Date(lifecycleOrder.order.expiresAt);
      await expiryEm.flush();
      assert.deepEqual(lifecycleOrder.order.items[0], {
        skuId: secondSkuId,
        productExternalId: `orders-test-${productId}`,
        productName: '并发测试大衣',
        color: '深蓝',
        size: 'L',
        imageUrl: null,
        unitPrice: '499.00',
        quantity: 2,
        lineAmount: '998.00',
      });

      const paid = await service.simulatePayment(ownerId, lifecycleOrderId);
      assert.equal(paid.status, OrderStatus.PENDING_SHIPMENT);
      assert.equal(paid.paymentMode, 'simulated');
      assert.equal(
        (await orm.em.fork().findOneOrFail(ProductSku, { id: secondSkuId }))
          .stock,
        4,
        '模拟支付不扣减实物库存',
      );
      const paidReservations = await orm.em
        .fork()
        .transactional((transaction) =>
          new ProductCatalogOrderService().getReservedQuantities(transaction, [
            secondSkuId,
          ]),
        );
      assert.equal(paidReservations.get(secondSkuId), 2);

      const shipment = shipOrderSchema.parse({
        carrier: '顺丰',
        trackingNo: `SF-${lifecycleOrderId}`,
      });
      const shipped = await service.shipForAdmin(lifecycleOrderId, shipment);
      assert.equal(shipped.status, OrderStatus.PENDING_RECEIPT);
      assert.deepEqual(shipped.shipment, {
        carrier: '顺丰',
        trackingNo: `SF-${lifecycleOrderId}`,
      });
      assert.equal(
        (await orm.em.fork().findOneOrFail(ProductSku, { id: secondSkuId }))
          .stock,
        2,
      );
      const shippedReservations = await orm.em
        .fork()
        .transactional((transaction) =>
          new ProductCatalogOrderService().getReservedQuantities(transaction, [
            secondSkuId,
          ]),
        );
      assert.equal(shippedReservations.has(secondSkuId), false);

      const retriedShipment = await service.shipForAdmin(
        lifecycleOrderId,
        shipment,
      );
      assert.equal(retriedShipment.status, OrderStatus.PENDING_RECEIPT);
      assert.equal(
        (await orm.em.fork().findOneOrFail(ProductSku, { id: secondSkuId }))
          .stock,
        2,
        '同物流信息的发货重试不重复扣库存',
      );

      const completed = await service.confirmReceiptForUser(
        ownerId,
        lifecycleOrderId,
      );
      assert.equal(completed.status, OrderStatus.COMPLETED);
      assert.deepEqual(completed.recipient, {
        name: '履约测试收件人',
        phone: '13800138000',
        address: '履约测试快照地址',
      });
      assert.equal(completed.items[0]?.lineAmount, '998.00');
      assert.equal(completed.paymentMode, 'simulated');

      const confirmedInput = (): ConfirmedOrderInput => ({
        idempotencyKey: randomUUID(),
        items: [{ skuId: secondSkuId, quantity: 1 }],
        recipient: {
          name: '确认事务测试收件人',
          phone: '13800138000',
          address: '确认事务测试地址',
        },
      });
      const confirmedSnapshot = (): ConfirmedOrderSnapshot => ({
        productExternalId: `orders-test-${productId}`,
        skuId: secondSkuId,
        productName: '并发测试大衣',
        color: '深蓝',
        size: 'L',
        unitPrice: '499.00',
        currency: 'CNY',
        imageUrl: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await t.test('共享调用方写入和订单创建在同一事务内回滚', async () => {
        const input = confirmedInput();
        const expected = { ...confirmedSnapshot(), productName: '应回滚名称' };
        await assert.rejects(
          orm.em.fork().transactional(async (transaction) => {
            await transaction.nativeUpdate(
              Product,
              { id: productId },
              {
                name: expected.productName,
              },
            );
            const created = await service.createConfirmedInTransaction(
              transaction,
              ownerId,
              input,
              expected,
            );
            assert.equal(created.kind, 'created');
            throw new Error('caller-rollback');
          }),
          /caller-rollback/u,
        );
        const verify = orm.em.fork();
        assert.equal(
          await verify.count(OrderIdempotency, {
            userId: ownerId,
            idempotencyKey: input.idempotencyKey,
          }),
          0,
        );
        assert.equal(
          (await verify.findOneOrFail(Product, { id: productId })).name,
          '并发测试大衣',
        );
        const remaining = await verify.transactional((transaction) =>
          new ProductCatalogOrderService().getReservedQuantities(transaction, [
            secondSkuId,
          ]),
        );
        assert.equal(remaining.get(secondSkuId) ?? 0, 0);
      });

      await t.test(
        '确认条件失败可提交业务失效结果，不写入订单和额外预占',
        async () => {
          for (const mismatch of [
            { unitPrice: '498.00' },
            { productName: '旧商品名称' },
            { color: '旧颜色' },
            { size: '旧尺码' },
            { imageUrl: 'https://example.com/old.png' },
          ]) {
            const input = confirmedInput();
            const result = await orm.em.fork().transactional((transaction) =>
              service.createConfirmedInTransaction(
                transaction,
                ownerId,
                input,
                {
                  ...confirmedSnapshot(),
                  ...mismatch,
                },
              ),
            );
            assert.deepEqual(result, { kind: 'quote_changed' });
            assert.equal(
              await orm.em.fork().count(OrderIdempotency, {
                idempotencyKey: input.idempotencyKey,
              }),
              0,
            );
          }
        },
      );

      await t.test(
        '等待 SKU 锁跨草稿期限后拒绝，支付期限从锁后实际时钟计算',
        async () => {
          const input = confirmedInput();
          const catalog = new ProductCatalogOrderService();
          const blocker = orm.em.fork();
          await blocker.begin();
          try {
            await catalog.lockSkus(blocker, [secondSkuId]);
            const times = await blocker
              .getConnection()
              .execute<Array<{ deadline: Date }>>(
                "select clock_timestamp() + interval '150 milliseconds' as deadline",
                [],
                'all',
                blocker.getTransactionContext(),
              );
            const resultPromise = orm.em.fork().transactional((transaction) =>
              service.createConfirmedInTransaction(
                transaction,
                ownerId,
                input,
                {
                  ...confirmedSnapshot(),
                  expiresAt: new Date(times[0]!.deadline),
                },
              ),
            );
            // 必须在截止后才放锁，事务起点的 now() 不能用于这次确认。
            await new Promise((resolve) => setTimeout(resolve, 250));
            await blocker.commit();
            const result = await resultPromise;
            assert.deepEqual(result, { kind: 'draft_expired' });
            assert.equal(
              await orm.em.fork().count(OrderIdempotency, {
                idempotencyKey: input.idempotencyKey,
              }),
              0,
            );
          } finally {
            if (blocker.getTransactionContext()) await blocker.rollback();
          }

          const successInput = confirmedInput();
          const success = await orm.em
            .fork()
            .transactional(async (transaction) => {
              const times = await transaction
                .getConnection()
                .execute<Array<{ started: Date }>>(
                  'select now() as started',
                  [],
                  'all',
                  transaction.getTransactionContext(),
                );
              await new Promise((resolve) => setTimeout(resolve, 100));
              const result = await service.createConfirmedInTransaction(
                transaction,
                ownerId,
                successInput,
                confirmedSnapshot(),
              );
              assert.ok('order' in result);
              assert.ok(
                new Date(result.order.createdAt).getTime() >
                  new Date(times[0]!.started).getTime(),
              );
              assert.equal(
                new Date(result.order.expiresAt).getTime() -
                  new Date(result.order.createdAt).getTime(),
                30 * 60_000,
              );
              return result;
            });
          assert.ok('order' in success);
          await service.cancelForUser(ownerId, success.order.id);
        },
      );

      await t.test(
        '等待 SKU 锁后重新读取父商品字段，不能接受等待前的旧名称',
        async () => {
          const input = confirmedInput();
          const blocker = orm.em.fork();
          await blocker.begin();
          try {
            await new ProductCatalogOrderService().lockSkus(blocker, [
              secondSkuId,
            ]);
            const confirmation = orm.em
              .fork()
              .transactional((transaction) =>
                service.createConfirmedInTransaction(
                  transaction,
                  ownerId,
                  input,
                  confirmedSnapshot(),
                ),
              );
            await new Promise((resolve) => setTimeout(resolve, 100));
            await blocker.nativeUpdate(
              Product,
              { id: productId },
              { name: '锁后新名称' },
            );
            await blocker.commit();
            assert.deepEqual(await confirmation, { kind: 'quote_changed' });
            assert.equal(
              await orm.em.fork().count(OrderIdempotency, {
                idempotencyKey: input.idempotencyKey,
              }),
              0,
            );
          } finally {
            if (blocker.getTransactionContext()) await blocker.rollback();
            await orm.em
              .fork()
              .nativeUpdate(
                Product,
                { id: productId },
                { name: '并发测试大衣' },
              );
          }
        },
      );
    } finally {
      if (migrated) {
        await connection.execute(
          `delete from order_idempotency
         where user_id in (?, ?, ?)`,
          [ownerId, otherOwnerId, secondOwnerId],
        );
        await connection.execute(
          `delete from order_items
         where order_id in (
           select id from orders where user_id in (?, ?, ?)
         )`,
          [ownerId, otherOwnerId, secondOwnerId],
        );
        await connection.execute(
          'delete from orders where user_id in (?, ?, ?)',
          [ownerId, otherOwnerId, secondOwnerId],
        );
        await connection.execute(
          'delete from product_skus where id in (?, ?)',
          [skuId, secondSkuId],
        );
        await connection.execute('delete from products where id = ?', [
          productId,
        ]);
        await connection.execute('delete from users where id in (?, ?, ?)', [
          ownerId,
          otherOwnerId,
          secondOwnerId,
        ]);
      }
      await orm.close(true);
    }
  },
);
