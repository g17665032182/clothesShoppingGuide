import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import { UserRole } from '../../users/entity/user.entity.js';
import { AdminProductTryOnImageController } from '../controller/admin-product-try-on-image.controller.js';
import { AdminProductCatalogService } from '../service/admin-product-catalog.service.js';
import { ProductTryOnImageService } from '../service/product-try-on-image.service.js';

test('商品试穿图片真实 HTTP 路由执行管理员权限、上传与私有预览', async () => {
  Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);
  const productId = '12345678-1234-4234-8234-123456789abc';
  const calls: string[] = [];
  @Module({
    controllers: [AdminProductTryOnImageController],
    providers: [
      { provide: RolesGuard, useValue: new RolesGuard(new Reflector()) },
      {
        provide: ProductTryOnImageService,
        useValue: {
          upload: async (id: string, file: { buffer: Buffer }) => {
            assert.equal(id, productId);
            assert.ok(file.buffer.byteLength > 0);
            calls.push('upload');
          },
          preview: async (id: string) => {
            assert.equal(id, productId);
            calls.push('preview');
            return Buffer.from('private-webp');
          },
        },
      },
      {
        provide: AdminProductCatalogService,
        useValue: {
          detail: async (id: string) => ({
            id,
            tryOnEnabled: false,
            hasTryOnImage: true,
          }),
        },
      },
    ],
  })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false });
  const jwt = new JwtService({ secret: 'admin-product-image-test-secret' });
  app.useGlobalGuards(
    new JwtAuthGuard(jwt, new Reflector(), {
      findActiveById: async (id: string) =>
        id === 'admin'
          ? { id, role: UserRole.ADMIN }
          : id === 'disabled'
            ? null
            : { id, role: UserRole.USER },
    } as never),
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/admin/product-catalog/products`;
  const admin = await jwt.signAsync({ sub: 'admin' });
  const user = await jwt.signAsync({ sub: 'user' });
  const disabled = await jwt.signAsync({ sub: 'disabled' });
  const upload = async (token?: string, id = productId) => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from('fixture')], { type: 'image/png' }),
      'fixture.png',
    );
    return fetch(`${base}/${id}/try-on-image`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
  };
  try {
    assert.equal((await upload()).status, 401);
    assert.equal((await upload(disabled)).status, 401);
    assert.equal((await upload(user)).status, 403);
    assert.equal((await upload(admin, 'invalid')).status, 400);
    const created = await upload(admin);
    const createdBody = await created.text();
    assert.equal(created.status, 201, createdBody);
    assert.equal(
      (JSON.parse(createdBody) as { hasTryOnImage: boolean }).hasTryOnImage,
      true,
    );

    const preview = await fetch(`${base}/${productId}/try-on-image`, {
      headers: { authorization: `Bearer ${admin}` },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/webp');
    assert.equal(preview.headers.get('cache-control'), 'private, no-store');
    assert.equal(await preview.text(), 'private-webp');
    assert.equal(calls.filter((call) => call === 'upload').length, 1);
    assert.equal(calls.filter((call) => call === 'preview').length, 1);
  } finally {
    await app.close();
  }
});
