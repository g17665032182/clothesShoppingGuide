import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { UserAddressesController } from '../controller/user-addresses.controller.js';
import { UserAddressesService } from '../service/user-addresses.service.js';

test('地址 HTTP 路由：JWT、严格 schema 和本人资源隔离', async () => {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const records = new Map<
    string,
    { ownerId: string; value: Record<string, unknown> }
  >();
  const service = {
    listForUser: async (
      ownerId: string,
      query: { page: number; pageSize: number },
    ) => {
      const items = [...records.values()]
        .filter((record) => record.ownerId === ownerId)
        .map((record) => record.value);
      return {
        items,
        total: items.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
    getForUser: async (ownerId: string, id: string) => {
      const record = records.get(id);
      if (!record || record.ownerId !== ownerId) {
        const { NotFoundException } = await import('@nestjs/common');
        throw new NotFoundException('收货地址不存在');
      }
      return record.value;
    },
    create: async (ownerId: string, input: Record<string, unknown>) => {
      const id = randomUUID();
      const value = {
        id,
        recipientName: input.recipientName,
        phone: input.phone,
        address: input.address,
        label: input.label ?? null,
        isDefault: input.isDefault ?? false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      records.set(id, { ownerId, value });
      return value;
    },
    update: async (
      ownerId: string,
      id: string,
      input: Record<string, unknown>,
    ) => {
      const record = records.get(id);
      if (!record || record.ownerId !== ownerId) {
        const { NotFoundException } = await import('@nestjs/common');
        throw new NotFoundException('收货地址不存在');
      }
      record.value = { ...record.value, ...input };
      return record.value;
    },
    delete: async (ownerId: string, id: string) => {
      const record = records.get(id);
      if (!record || record.ownerId !== ownerId) {
        const { NotFoundException } = await import('@nestjs/common');
        throw new NotFoundException('收货地址不存在');
      }
      records.delete(id);
    },
  };
  @Module({
    controllers: [UserAddressesController],
    providers: [{ provide: UserAddressesService, useValue: service }],
  })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false });
  const jwt = new JwtService({ secret: 'user-address-http-fixture-secret' });
  app.useGlobalGuards(
    new JwtAuthGuard(jwt, new Reflector(), {
      findActiveById: async (id: string) =>
        id === userId || id === otherUserId ? { id } : null,
    } as never),
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const tokenFor = (id: string) => jwt.signAsync({ sub: id });
  const request = (
    url: string,
    token?: string,
    method = 'GET',
    body?: unknown,
  ) =>
    fetch(`${base}${url}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const path = '/users/me/addresses';
    assert.equal((await request(path)).status, 401);
    assert.equal(
      (await request(`${path}?unknown=true`, await tokenFor(userId))).status,
      400,
    );
    assert.equal(
      (await request(`${path}/invalid`, await tokenFor(userId))).status,
      400,
    );
    assert.equal(
      (
        await request(path, await tokenFor(userId), 'POST', {
          requestKey: randomUUID(),
          recipientName: '本人',
          phone: '13800138000',
          address: '虚构测试地址',
          userId: otherUserId,
        })
      ).status,
      400,
    );
    const created = await request(path, await tokenFor(userId), 'POST', {
      requestKey: randomUUID(),
      recipientName: '本人',
      phone: '13800138000',
      address: '虚构测试地址',
    });
    assert.equal(created.status, 201, await created.clone().text());
    const response = (await created.json()) as Record<string, unknown>;
    assert.equal(typeof response.id, 'string');
    assert.equal('userId' in response, false);
    assert.equal(
      (
        await request(
          `${path}/${String(response.id)}`,
          await tokenFor(otherUserId),
        )
      ).status,
      404,
    );
  } finally {
    await app.close();
  }
});
