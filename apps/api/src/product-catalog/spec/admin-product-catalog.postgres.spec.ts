import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  Module,
  StandardSchemaValidationPipe,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import { UserRole } from '../../users/entity/user.entity.js';
import { Product } from '../entity/product.entity.js';
import { ProductSku } from '../entity/product-sku.entity.js';
import { AdminProductCatalogController } from '../controller/admin-product-catalog.controller.js';
import { AdminProductCatalogService } from '../service/admin-product-catalog.service.js';
import { adminProductQuerySchema } from '../dto/admin-product-query.dto.js';
import { ProductCatalogTryOnService } from '../service/product-catalog-try-on.service.js';
import { ProductCatalogImportService } from '../service/product-catalog-import.service.js';
import { productCatalogImportSchema } from '../import/product-catalog-import.schema.js';
import { ProductCatalogService } from '../service/product-catalog.service.js';

test(
  '专用 PostgreSQL：管理员商品筛选、精确库存、分页、详情与角色隔离',
  {
    skip: process.env.RUN_ADMIN_PRODUCTS_POSTGRES_TEST !== '1',
    timeout: 60_000,
  },
  async () => {
    const dbName = process.env.ADMIN_PRODUCTS_TEST_DB ?? '';
    assert.match(dbName, /^clothes_guide_(?:admin|orders)_test_[a-z0-9_]+$/u);
    assert.notEqual(dbName, config.dbName);
    const orm = await MikroORM.init({
      ...config,
      dbName,
      entities: [Product, ProductSku],
      entitiesTs: [Product, ProductSku],
      debug: false,
    });
    const connection = orm.em.getConnection();
    const userId = randomUUID();
    const productIds = [randomUUID(), randomUUID()].sort();
    const skuIds = [randomUUID(), randomUUID(), randomUUID()];
    const orderId = randomUUID();
    const itemId = randomUUID();
    const prefix = `admin-fixture-${randomUUID()}`;
    let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
    try {
      // 只对明确隔离且已迁移的库写随机夹具，不执行迁移或重建 schema。
      await orm.em.fork().transactional(async (transaction) => {
        const tx = transaction.getTransactionContext();
        await connection.execute(
          `insert into users (id,email,password_hash,display_name,role,status,created_at,updated_at)
         values (?, ?, 'fixture-not-login', '管理员商品测试', 'admin', 'active', now(), now())`,
          [userId, `${prefix}@local.invalid`],
          'run',
          tx,
        );
        for (const [index, id] of productIds.entries()) {
          await connection.execute(
            `insert into products (id,external_id,name,brand,category,is_active,created_at,updated_at)
           values (?, ?, ?, ?, 'outerwear', ?, now(), '2026-11-07T00:00:00Z')`,
            [
              id,
              `${prefix}-${index}`,
              index === 0 ? `${prefix}%_literal` : `${prefix}XYliteral`,
              `brand-${prefix}`,
              index === 0,
            ],
            'run',
            tx,
          );
        }
        for (const [index, id] of skuIds.entries()) {
          await connection.execute(
            `insert into product_skus (id,product_id,external_sku_id,color,size,price,currency,stock,is_active,created_at,updated_at)
           values (?, ?, ?, '黑色', ?, ?, 'CNY', ?, ?, now(), now())`,
            [
              id,
              productIds[index === 2 ? 1 : 0],
              `${prefix}-sku-${index}`,
              ['M', 'L', 'S'][index],
              ['10.10', '9.99', '1.01'][index],
              [5, 4, 0][index],
              index !== 1,
            ],
            'run',
            tx,
          );
        }
        await connection.execute(
          `insert into orders (id,order_no,user_id,status,items_amount,payable_amount,recipient_name,recipient_phone,recipient_address,expires_at)
         values (?, ?, ?, 'pending_payment', '20.20', '20.20', '测试', '13800138000', '隔离库夹具', now() + interval '30 minutes')`,
          [orderId, prefix, userId],
          'run',
          tx,
        );
        await connection.execute(
          `insert into order_items (id,order_id,sku_id,product_external_id,product_name,color,size,unit_price,quantity,line_amount)
         values (?, ?, ?, ?, '测试快照', '黑色', 'M', '10.10', 2, '20.20')`,
          [itemId, orderId, skuIds[0], `${prefix}-0`],
          'run',
          tx,
        );
      });

      const service = new AdminProductCatalogService(
        orm.em.fork().getRepository(Product),
        new ProductCatalogTryOnService(orm.em.fork().getRepository(Product)),
      );
      const list = (query: Record<string, unknown>) =>
        service.list(adminProductQuerySchema.parse(query));
      const all = await list({ keyword: prefix });
      assert.equal(all.total, 2);
      assert.deepEqual(
        all.items.map((item) => item.id),
        [...productIds].reverse(),
      );
      assert.equal(
        (await list({ keyword: `${prefix}%_literal` })).total,
        1,
        '百分号和下划线必须按字面匹配',
      );
      assert.equal((await list({ keyword: `brand-${prefix}` })).total, 2);
      assert.equal(
        (await list({ keyword: prefix, isActive: 'false' })).items[0]?.id,
        productIds[1],
      );
      assert.equal(
        (await list({ keyword: prefix, inStock: 'false' })).items[0]?.id,
        productIds[1],
      );
      assert.equal(
        (await list({ keyword: prefix, inStock: 'true' })).items[0]?.id,
        productIds[0],
      );
      assert.equal(
        (await list({ keyword: prefix, pageSize: '1', page: '1' })).items[0]
          ?.id,
        productIds[1],
      );
      assert.equal(
        (await list({ keyword: prefix, pageSize: '1', page: '2' })).items[0]
          ?.id,
        productIds[0],
      );

      const detail = await service.detail(productIds[0]!);
      assert.equal(detail.totalStock, 9);
      assert.equal(detail.totalAvailableStock, 7);
      assert.equal(detail.lowestPrice, '9.99');
      assert.equal(detail.skuCount, 2);
      const reservedSku = detail.skus.find((sku) => sku.id === skuIds[0]);
      assert.equal(reservedSku?.price, '10.10');
      assert.equal(reservedSku?.stock, 5);
      assert.equal(reservedSku?.reservedStock, 2);
      assert.equal(reservedSku?.availableStock, 3);
      assert.equal(
        detail.skus.find((sku) => sku.id === skuIds[1])?.isActive,
        false,
      );
      assert.equal((await service.detail(productIds[1]!)).isActive, false);
      await assert.rejects(service.detail(randomUUID()), NotFoundException);

      const activeProductId = productIds[0]!;
      assert.equal(detail.tryOnEnabled, false, '存量和新商品默认关闭');
      await assert.rejects(
        service.updateTryOn(activeProductId, { tryOnEnabled: true }),
        ConflictException,
      );
      await connection.execute(
        'update product_skus set image_url=? where id=?',
        ['https://images.example.org/coat.webp', skuIds[0]],
      );
      const enabled = await service.updateTryOn(activeProductId, {
        tryOnEnabled: true,
      });
      assert.equal(enabled.tryOnEnabled, true);
      assert.equal(
        (await service.updateTryOn(activeProductId, { tryOnEnabled: true }))
          .tryOnEnabled,
        true,
      );
      assert.equal(enabled.totalAvailableStock, 7);

      const input = productCatalogImportSchema.parse({
        version: 1,
        products: [
          {
            externalId: `${prefix}-0`,
            name: '重复导入保留试穿开关',
            category: 'outerwear',
            skus: [
              {
                externalSkuId: `${prefix}-sku-0`,
                color: '黑色',
                size: 'M',
                price: 10.1,
                stock: 5,
                imageUrl: 'https://images.example.org/coat.webp',
              },
            ],
          },
        ],
      });
      await orm.em
        .fork()
        .transactional((transaction) =>
          new ProductCatalogImportService().upsertInTransaction(
            transaction,
            input.products,
          ),
        );
      assert.equal(
        (await service.detail(activeProductId)).tryOnEnabled,
        true,
        '重复导入不得重置管理员配置',
      );
      const catalog = new ProductCatalogService(
        orm.em.fork().getRepository(Product),
        new ConfigService({
          PRODUCT_QUERY_CURSOR_SECRET:
            'isolated-try-on-cursor-secret-32-characters',
        }),
        new ProductCatalogTryOnService(orm.em.fork().getRepository(Product)),
      );
      const search = await catalog.search({ category: 'outerwear', limit: 3 });
      assert.equal(
        search.items.find((item) => item.externalId === `${prefix}-0`)
          ?.tryOnEnabled,
        true,
      );

      for (const category of ['shoes', 'tops']) {
        await connection.execute('update products set category=? where id=?', [
          category,
          activeProductId,
        ]);
        if (category === 'shoes')
          await assert.rejects(
            service.updateTryOn(activeProductId, { tryOnEnabled: true }),
            ConflictException,
          );
      }
      await connection.execute(
        'update products set is_active=false where id=?',
        [activeProductId],
      );
      await assert.rejects(
        service.updateTryOn(activeProductId, { tryOnEnabled: true }),
        ConflictException,
      );
      assert.equal(
        (await service.updateTryOn(activeProductId, { tryOnEnabled: false }))
          .tryOnEnabled,
        false,
      );
      await connection.execute(
        "update products set is_active=true, category='outerwear' where id=?",
        [activeProductId],
      );
      await connection.execute('update product_skus set color=? where id=?', [
        ' ',
        skuIds[0],
      ]);
      await assert.rejects(
        service.updateTryOn(activeProductId, { tryOnEnabled: true }),
        ConflictException,
      );
      await connection.execute(
        'update product_skus set color=?, stock=0 where id=?',
        ['黑色', skuIds[0]],
      );
      assert.equal(
        (await service.updateTryOn(activeProductId, { tryOnEnabled: true }))
          .tryOnEnabled,
        true,
        '库存不是开启条件',
      );
      await connection.execute('update product_skus set stock=5 where id=?', [
        skuIds[0],
      ]);
      await Promise.all([
        service.updateTryOn(activeProductId, { tryOnEnabled: false }),
        service.updateTryOn(activeProductId, { tryOnEnabled: true }),
      ]);
      assert.equal(
        (await service.detail(activeProductId)).totalStock,
        9,
        '并发配置不得影响库存',
      );

      Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);
      @Module({
        controllers: [AdminProductCatalogController],
        providers: [
          { provide: AdminProductCatalogService, useValue: service },
          { provide: RolesGuard, useValue: new RolesGuard(new Reflector()) },
        ],
      })
      class HttpFixtureModule {}
      app = await NestFactory.create(HttpFixtureModule, { logger: false });
      const jwt = new JwtService({ secret: 'isolated-admin-pg-http-test' });
      app.useGlobalGuards(
        new JwtAuthGuard(jwt, new Reflector(), {
          findActiveById: async (id: string) => ({
            id,
            role: id === userId ? UserRole.ADMIN : UserRole.USER,
          }),
        } as never),
      );
      app.useGlobalPipes(new StandardSchemaValidationPipe());
      app.setGlobalPrefix('api');
      await app.listen(0, '127.0.0.1');
      const base = `${await app.getUrl()}/api/admin/product-catalog/products`;
      const adminToken = await jwt.signAsync({ sub: userId });
      const userToken = await jwt.signAsync({ sub: randomUUID() });
      assert.equal((await fetch(base)).status, 401);
      assert.equal(
        (
          await fetch(base, {
            headers: { authorization: `Bearer ${userToken}` },
          })
        ).status,
        403,
      );
      const response = await fetch(`${base}/${productIds[0]}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        skus: Array<{ reservedStock: number }>;
        tryOnEnabled: boolean;
      };
      assert.equal(
        body.skus.some((sku) => sku.reservedStock === 2),
        true,
      );
      const patch = await fetch(`${base}/${activeProductId}/try-on`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ tryOnEnabled: false }),
      });
      assert.equal(patch.status, 200);
      assert.equal(
        ((await patch.json()) as { tryOnEnabled: boolean }).tryOnEnabled,
        false,
      );
    } finally {
      if (app) await app.close();
      await orm.em.fork().transactional(async (transaction) => {
        const tx = transaction.getTransactionContext();
        await connection.execute(
          'delete from order_items where id = ?',
          [itemId],
          'run',
          tx,
        );
        await connection.execute(
          'delete from orders where id = ?',
          [orderId],
          'run',
          tx,
        );
        for (const id of skuIds)
          await connection.execute(
            'delete from product_skus where id = ?',
            [id],
            'run',
            tx,
          );
        for (const id of productIds)
          await connection.execute(
            'delete from products where id = ?',
            [id],
            'run',
            tx,
          );
        await connection.execute(
          'delete from users where id = ?',
          [userId],
          'run',
          tx,
        );
      });
      await orm.close(true);
    }
  },
);
