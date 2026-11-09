import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConflictException,
  Module,
  NotFoundException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
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
  const updates: unknown[] = [];
  const productId = '54b8b9fc-9d24-49e8-9d28-b52bff3fa110';
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
          updateTryOn: async (id: string, input: { tryOnEnabled: boolean }) => {
            updates.push({ id, ...input });
            if (id === '00000000-0000-4000-8000-000000000000')
              throw new NotFoundException('商品不存在');
            if (id === '00000000-0000-4000-8000-000000000001')
              throw new ConflictException({
                code: 'PRODUCT_NOT_TRYON_SUPPORTED',
                message: '当前商品不符合试穿开启条件',
              });
            return { id, ...input, skus: [] };
          },
        },
      },
    ],
  })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false });
  const jwt = new JwtService({ secret: 'admin-product-test-secret' });
  app.useGlobalGuards(
    new JwtAuthGuard(jwt, new Reflector(), {
      findActiveById: async (id: string) =>
        id === 'disabled'
          ? null
          : {
              id,
              role: id === 'admin' ? UserRole.ADMIN : UserRole.USER,
            },
    } as never),
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/admin/product-catalog/products`;
  const admin = await jwt.signAsync({ sub: 'admin' });
  const user = await jwt.signAsync({ sub: 'user' });
  const disabled = await jwt.signAsync({ sub: 'disabled' });
  const request = (suffix: string, token?: string) =>
    fetch(`${base}${suffix}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const update = (body: unknown, token?: string, id = productId) =>
    fetch(`${base}/${id}/try-on`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
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
    assert.equal((await update({ tryOnEnabled: true })).status, 401);
    assert.equal((await update({ tryOnEnabled: true }, disabled)).status, 401);
    assert.equal((await update({ tryOnEnabled: true }, user)).status, 403);
    assert.equal(
      (await update({ tryOnEnabled: true }, admin, 'invalid')).status,
      400,
    );
    for (const body of [
      {},
      { tryOnEnabled: 'true' },
      { tryOnEnabled: null },
      { tryOnEnabled: 1 },
      { tryOnEnabled: true, isActive: true },
    ]) {
      assert.equal((await update(body, admin)).status, 400);
    }
    assert.equal(updates.length, 0);
    const response = await update({ tryOnEnabled: true }, admin);
    assert.equal(response.status, 200);
    assert.equal(
      ((await response.json()) as { tryOnEnabled: boolean }).tryOnEnabled,
      true,
    );
    assert.equal((await update({ tryOnEnabled: false }, admin)).status, 200);
    assert.deepEqual(updates, [
      { id: productId, tryOnEnabled: true },
      { id: productId, tryOnEnabled: false },
    ]);
    assert.equal(
      (
        await update(
          { tryOnEnabled: true },
          admin,
          '00000000-0000-4000-8000-000000000000',
        )
      ).status,
      404,
    );
    const conflict = await update(
      { tryOnEnabled: true },
      admin,
      '00000000-0000-4000-8000-000000000001',
    );
    assert.equal(conflict.status, 409);
    assert.equal(
      ((await conflict.json()) as { code: string }).code,
      'PRODUCT_NOT_TRYON_SUPPORTED',
    );
  } finally {
    await app.close();
  }
});
