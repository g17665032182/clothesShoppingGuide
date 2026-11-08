import 'reflect-metadata';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';
import { ProductCatalogOrderService } from '../service/product-catalog-order.service.js';
import { ProductCatalogPurchaseService } from '../service/product-catalog-purchase.service.js';
import { ServiceUnavailableException } from '@nestjs/common';

const productId = randomUUID();
const skuId = randomUUID();
const firstOrderId = randomUUID();
const secondOrderId = randomUUID();

test(
  '专用 PostgreSQL：SKU 行锁串行化库存写入，预占视图汇总有效订单',
  {
    skip: process.env.RUN_ORDERS_POSTGRES_TEST !== '1',
    timeout: 60_000,
  },
  async () => {
    const dbName = process.env.ORDERS_TEST_DB ?? '';
    assert.match(dbName, /^clothes_guide_orders_test_[a-z0-9_]+$/u);
    assert.notEqual(dbName, config.dbName);

    const schema = `orders_test_${randomUUID().replaceAll('-', '')}`;
    const orm = await MikroORM.init({
      ...config,
      dbName,
      schema,
      entities: [],
      entitiesTs: [],
      allowGlobalContext: false,
      debug: false,
      driverOptions: {
        ...config.driverOptions,
        options: `-c search_path=${schema},public`,
      },
    });
    const connection = orm.em.getConnection();
    const service = new ProductCatalogOrderService();

    try {
      await connection.execute(`create schema "${schema}"`);
      await connection.execute(`create table "${schema}".products (
          id uuid primary key,
          external_id text not null,
          name text not null,
          is_active boolean not null
        )`);
      await connection.execute(`create table "${schema}".product_skus (
          id uuid primary key,
          product_id uuid not null,
          external_sku_id text not null,
          color text not null,
          size text not null,
          price numeric(12, 2) not null,
          currency text not null,
          stock integer not null,
          is_active boolean not null,
          image_url text null
        )`);
      await connection.execute(`create table "${schema}".orders (
          id uuid primary key,
          status text not null
        )`);
      await connection.execute(`create table "${schema}".order_items (
          order_id uuid not null,
          sku_id uuid not null,
          quantity integer not null
        )`);
      await connection.execute(`create view "${schema}".active_order_sku_reservations as
          select item.sku_id, sum(item.quantity)::bigint as reserved_quantity
          from "${schema}".order_items item
          join "${schema}".orders order_record on order_record.id = item.order_id
          where order_record.status in ('pending_payment', 'pending_shipment')
          group by item.sku_id`);
      await connection.execute(
        `insert into "${schema}".products (id, external_id, name, is_active)
         values (?, 'coat-1', '测试大衣', true)`,
        [productId],
      );
      await connection.execute(
        `insert into "${schema}".product_skus
         (id, product_id, external_sku_id, color, size, price, currency, stock, is_active)
         values (?, ?, 'coat-1-black-m', '黑色', 'M', 899.00, 'CNY', 4, true)`,
        [skuId, productId],
      );
      await connection.execute(
        `insert into "${schema}".orders (id, status)
         values (?, 'pending_payment'), (?, 'pending_shipment')`,
        [firstOrderId, secondOrderId],
      );
      await connection.execute(
        `insert into "${schema}".order_items (order_id, sku_id, quantity)
         values (?, ?, 1), (?, ?, 2)`,
        [firstOrderId, skuId, secondOrderId, skuId],
      );

      const first = orm.em.fork();
      const contender = orm.em.fork();
      let locked!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let releaseFirst!: () => void;
      const firstTransactionGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let secondFinished = false;

      const firstWrite = first.transactional(async (transaction) => {
        await service.lockSkus(transaction, [skuId]);
        locked();
        await firstTransactionGate;
      });
      await lockAcquired;

      const secondWrite = contender.transactional(async (transaction) => {
        await service.lockSkus(transaction, [skuId]);
        secondFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(secondFinished, false, '竞争事务必须等待持锁事务');

      releaseFirst();
      await Promise.all([firstWrite, secondWrite]);
      assert.equal(secondFinished, true);

      const reservations = await orm.em
        .fork()
        .transactional((transaction) =>
          service.getReservedQuantities(transaction, [skuId]),
        );
      assert.equal(reservations.get(skuId), 3);

      await connection.execute(
        `update "${schema}".orders set status = 'closed' where id = ?`,
        [firstOrderId],
      );
      const afterClose = await orm.em
        .fork()
        .transactional((transaction) =>
          service.getReservedQuantities(transaction, [skuId]),
        );
      assert.equal(afterClose.get(skuId), 2);

      // 第 21 个规格仍有货，完整读取不能因默认第一页只见一个有货而自动选择。
      const lastSkuId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      for (let index = 0; index < 20; index += 1) {
        const id =
          index === 19
            ? lastSkuId
            : `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        await connection.execute(
          `insert into "${schema}".product_skus
           (id, product_id, external_sku_id, color, size, price, currency, stock, is_active)
           values (?, ?, ?, ?, 'M', 899.00, 'CNY', ?, true)`,
          [
            id,
            productId,
            `complete-${index}`,
            `颜色${index}`,
            index === 19 ? 1 : 0,
          ],
        );
      }
      const purchase = new ProductCatalogPurchaseService();
      const complete = await orm.em
        .fork()
        .transactional((transaction) =>
          purchase.getPurchaseSpecifications(transaction, 'coat-1'),
        );
      assert.equal(complete?.skus.length, 21);
      assert.equal(complete?.skus.at(-1)?.skuId, lastSkuId);
      assert.equal(complete?.skus.filter((sku) => sku.inStock).length, 2);
      assert.equal(
        JSON.stringify(complete).includes('reserved_quantity'),
        false,
      );
      assert.equal(JSON.stringify(complete).includes('"stock"'), false);

      for (let index = 0; index < 80; index += 1) {
        await connection.execute(
          `insert into "${schema}".product_skus
           (id, product_id, external_sku_id, color, size, price, currency, stock, is_active)
           values (?, ?, ?, '黑色', 'M', 899.00, 'CNY', 1, true)`,
          [randomUUID(), productId, `overflow-${index}`],
        );
      }
      await assert.rejects(
        orm.em
          .fork()
          .transactional((transaction) =>
            purchase.getPurchaseSpecifications(transaction, 'coat-1'),
          ),
        ServiceUnavailableException,
      );
    } finally {
      await connection.execute(`drop schema if exists "${schema}" cascade`);
      await orm.close(true);
    }
  },
);
