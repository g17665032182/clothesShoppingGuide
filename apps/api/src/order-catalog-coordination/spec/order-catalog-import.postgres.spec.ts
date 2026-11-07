import 'reflect-metadata';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { ConflictException } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';
import {
  Order,
  OrderCloseReason,
  OrderStatus,
} from '../../orders/entity/order.entity.js';
import { OrderIdempotency } from '../../orders/entity/order-idempotency.entity.js';
import { OrderItem } from '../../orders/entity/order-item.entity.js';
import { OrdersService } from '../../orders/service/orders.service.js';
import { Product } from '../../product-catalog/entity/product.entity.js';
import { ProductSku } from '../../product-catalog/entity/product-sku.entity.js';
import { ProductCatalogImportService } from '../../product-catalog/service/product-catalog-import.service.js';
import { ProductCatalogOrderService } from '../../product-catalog/service/product-catalog-order.service.js';
import { productCatalogImportSchema } from '../../product-catalog/import/product-catalog-import.schema.js';
import { User } from '../../users/entity/user.entity.js';
import { createOrderSchema } from '../../orders/dto/create-order.dto.js';
import { OrderCatalogImportService } from '../service/order-catalog-import.service.js';

const userId = randomUUID();
const productId = randomUUID();
const skuId = randomUUID();
const secondSkuId = randomUUID();
const productExternalId = `order-import-test-${productId}`;
const externalSkuId = `order-import-test-sku-${skuId}`;
const secondExternalSkuId = `order-import-test-sku-${secondSkuId}`;

function importProducts(input: { productActive: boolean; stock: number }) {
  return productCatalogImportSchema.parse({
    version: 1,
    products: [
      {
        externalId: productExternalId,
        name: '订单下架事务测试商品',
        category: 'outerwear',
        isActive: input.productActive,
        skus: [
          {
            externalSkuId,
            color: '黑色',
            size: 'M',
            price: 899,
            stock: input.stock,
          },
          {
            externalSkuId: secondExternalSkuId,
            color: '黑色',
            size: 'L',
            price: 899,
            stock: 4,
          },
        ],
      },
    ],
  }).products;
}

test(
  '专用 PostgreSQL：库存导入失败回滚，下架成功关闭整单并释放全部预占',
  {
    skip: process.env.RUN_ORDERS_POSTGRES_TEST !== '1',
    timeout: 60_000,
  },
  async () => {
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
    let orderId: string | undefined;

    try {
      await orm.migrator.up();
      migrated = true;

      const em = orm.em.fork();
      em.persist(
        Object.assign(new User(), {
          id: userId,
          email: `order-import-test-${userId}@local.invalid`,
          passwordHash: 'non-login-test-fixture',
          displayName: '订单目录导入测试用户',
        }),
      );
      em.persist(
        Object.assign(new Product(), {
          id: productId,
          externalId: productExternalId,
          name: '订单下架事务测试商品',
          category: 'outerwear',
          isActive: true,
        }),
      );
      await em.flush();
      em.persist(
        Object.assign(new ProductSku(), {
          id: skuId,
          productId,
          externalSkuId,
          color: '黑色',
          size: 'M',
          price: '899.00',
          currency: 'CNY',
          stock: 5,
          isActive: true,
        }),
      );
      em.persist(
        Object.assign(new ProductSku(), {
          id: secondSkuId,
          productId,
          externalSkuId: secondExternalSkuId,
          color: '黑色',
          size: 'L',
          price: '899.00',
          currency: 'CNY',
          stock: 4,
          isActive: true,
        }),
      );
      await em.flush();

      const catalogPort = new ProductCatalogOrderService();
      const orders = new OrdersService(
        orm.em.getRepository(Order),
        catalogPort,
      );
      const importService = new OrderCatalogImportService(
        orm,
        catalogPort,
        orders,
        new ProductCatalogImportService(),
      );
      const created = await orders.createForUser(
        userId,
        createOrderSchema.parse({
          idempotencyKey: randomUUID(),
          items: [
            { skuId, quantity: 3 },
            { skuId: secondSkuId, quantity: 2 },
          ],
          recipient: {
            name: '测试收件人',
            phone: '13800138000',
            address: '隔离测试地址',
          },
        }),
      );
      orderId = created.order.id;
      assert.equal(created.order.status, OrderStatus.PENDING_PAYMENT);

      await assert.rejects(
        importService.import(importProducts({ productActive: true, stock: 2 })),
        ConflictException,
      );

      const afterRejectedImport = await orm.em
        .fork()
        .findOneOrFail(ProductSku, {
          id: skuId,
        });
      assert.equal(afterRejectedImport.stock, 5);
      const reservedBeforeClose = await orm.em
        .fork()
        .transactional((transaction) =>
          catalogPort.getReservedQuantities(transaction, [skuId, secondSkuId]),
        );
      assert.equal(reservedBeforeClose.get(skuId), 3);
      assert.equal(reservedBeforeClose.get(secondSkuId), 2);

      await importService.import(
        importProducts({ productActive: false, stock: 0 }),
      );

      const closed = await orm.em.fork().findOneOrFail(Order, { id: orderId });
      assert.equal(closed.status, OrderStatus.CLOSED);
      assert.equal(closed.closeReason, OrderCloseReason.PRODUCT_UNAVAILABLE);
      assert.ok(closed.closedAt);
      const reservationsAfterClose = await orm.em
        .fork()
        .transactional((transaction) =>
          catalogPort.getReservedQuantities(transaction, [skuId, secondSkuId]),
        );
      assert.equal(reservationsAfterClose.has(skuId), false);
      assert.equal(reservationsAfterClose.has(secondSkuId), false);

      const importedSku = await orm.em.fork().findOneOrFail(ProductSku, {
        id: skuId,
      });
      assert.equal(importedSku.stock, 0);
      const importedProduct = await orm.em.fork().findOneOrFail(Product, {
        id: productId,
      });
      assert.equal(importedProduct.isActive, false);
    } finally {
      if (migrated) {
        if (orderId) {
          await connection.execute(
            'delete from order_idempotency where order_id = ?',
            [orderId],
          );
          await connection.execute(
            'delete from order_items where order_id = ?',
            [orderId],
          );
          await connection.execute('delete from orders where id = ?', [
            orderId,
          ]);
        }
        await connection.execute(
          'delete from product_skus where id in (?, ?)',
          [skuId, secondSkuId],
        );
        await connection.execute('delete from products where id = ?', [
          productId,
        ]);
        await connection.execute('delete from users where id = ?', [userId]);
      }
      await orm.close(true);
    }
  },
);
