import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { ProductSkuController } from '../controller/product-sku.controller.js';
import { productSkuQuerySchema } from '../dto/product-sku-query.dto.js';
import { ProductCatalogService } from '../service/product-catalog.service.js';

const ownerId = '54b8b9fc-9d24-49e8-9d28-b52bff3fa110';

test('SKU Query 默认分页、转换数字并拒绝非法筛选字段', () => {
  assert.deepEqual(
    productSkuQuerySchema.parse({ productExternalId: ' coat-1 ' }),
    {
      productExternalId: 'coat-1',
      page: 1,
      pageSize: 20,
    },
  );
  assert.deepEqual(
    productSkuQuerySchema.parse({
      productExternalId: 'coat-1',
      page: '2',
      pageSize: '50',
    }),
    { productExternalId: 'coat-1', page: 2, pageSize: 50 },
  );

  for (const query of [
    {},
    { productExternalId: ' ' },
    { productExternalId: 'coat-1', page: '' },
    { productExternalId: 'coat-1', page: '1.5' },
    { productExternalId: 'coat-1', pageSize: '101' },
    { productExternalId: 'coat-1', page: null },
    { productExternalId: 'coat-1', unexpected: true },
    { productExternalId: 'coat-1', userId: ownerId },
    { productExternalId: 'coat\u0000-1' },
  ]) {
    assert.equal(productSkuQuerySchema.safeParse(query).success, false);
  }
});

test('真实 Nest SKU 路由执行认证、Query Pipe 和安全响应投影', async () => {
  const calls: unknown[] = [];
  const catalog = {
    async listSkus(query: unknown) {
      calls.push(query);
      const pagination = query as { page: number; pageSize: number };
      return {
        items: [
          {
            skuId: '54b8b9fc-9d24-49e8-9d28-b52bff3fa111',
            productExternalId: 'coat-1',
            productName: '测试大衣',
            color: '黑色',
            size: 'M',
            unitPrice: '899.00',
            currency: 'CNY',
            inStock: true,
            imageUrl: null,
          },
        ],
        total: 1,
        page: pagination.page,
        pageSize: pagination.pageSize,
      };
    },
  };

  @Module({
    controllers: [ProductSkuController],
    providers: [{ provide: ProductCatalogService, useValue: catalog }],
  })
  class ProductSkuHttpFixtureModule {}

  const app = await NestFactory.create(ProductSkuHttpFixtureModule, {
    logger: ['error'],
  });
  const jwt = new JwtService({ secret: 'product-sku-http-test-secret' });
  app.useGlobalGuards(
    new JwtAuthGuard(jwt, new Reflector(), {
      findActiveById: async (id: string) => ({ id }),
    } as never),
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');

  const baseUrl = await app.getUrl();
  const token = await jwt.signAsync({ sub: ownerId });
  async function request(query: string, auth = token) {
    return fetch(`${baseUrl}/api/product-catalog/skus${query}`, {
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });
  }

  try {
    assert.equal((await request('?productExternalId=coat-1', '')).status, 401);
    assert.equal(
      (await request('?productExternalId=coat-1&unknown=value')).status,
      400,
    );

    const response = await request(
      '?productExternalId=coat-1&page=2&pageSize=10',
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      { productExternalId: 'coat-1', page: 2, pageSize: 10 },
    ]);
    assert.deepEqual(await response.json(), {
      items: [
        {
          skuId: '54b8b9fc-9d24-49e8-9d28-b52bff3fa111',
          productExternalId: 'coat-1',
          productName: '测试大衣',
          color: '黑色',
          size: 'M',
          unitPrice: '899.00',
          currency: 'CNY',
          inStock: true,
          imageUrl: null,
        },
      ],
      total: 1,
      page: 2,
      pageSize: 10,
    });
  } finally {
    await app.close();
  }
});
