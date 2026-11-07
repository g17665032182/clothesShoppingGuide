import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import { UserRole } from '../../users/entity/user.entity.js';
import { AdminProductCatalogController } from '../controller/admin-product-catalog.controller.js';
import { AdminProductCatalogService } from '../service/admin-product-catalog.service.js';

test('真实管理员商品路由执行认证、角色授权与严格 Query/Param 校验', async () => {
  // tsx 不生成构造参数元数据，补齐 Guard 的注入元数据以复用真实角色守卫。
  Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);
  const queries: unknown[] = [];
  @Module({
    controllers: [AdminProductCatalogController],
    providers: [
      { provide: RolesGuard, useValue: new RolesGuard(new Reflector()) },
      {
        provide: AdminProductCatalogService,
        useValue: {
          list: async (query: unknown) => {
            queries.push(query);
            return { items: [], total: 0, page: 1, pageSize: 20 };
          },
          detail: async (id: string) => ({ id, skus: [] }),
        },
      },
    ],
  })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false });
  const jwt = new JwtService({ secret: 'admin-product-test-secret' });
  app.useGlobalGuards(
    new JwtAuthGuard(jwt, new Reflector(), {
      findActiveById: async (id: string) => ({
        id,
        role: id === 'admin' ? UserRole.ADMIN : UserRole.USER,
      }),
    } as never),
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/admin/product-catalog/products`;
  const admin = await jwt.signAsync({ sub: 'admin' });
  const user = await jwt.signAsync({ sub: 'user' });
  const request = (suffix: string, token?: string) =>
    fetch(`${base}${suffix}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  try {
    assert.equal((await request('')).status, 401);
    assert.equal((await request('', user)).status, 403);
    assert.equal((await request('?unknown=1', admin)).status, 400);
    assert.equal((await request('/invalid-id', admin)).status, 400);
    assert.equal((await request('?page=2&isActive=false', admin)).status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(queries)), [
      { page: 2, pageSize: 20, isActive: false },
    ]);
  } finally {
    await app.close();
  }
});
