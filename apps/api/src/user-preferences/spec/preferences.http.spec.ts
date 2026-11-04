import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Module,
  NotFoundException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { UserPreferencesController } from '../controller/user-preferences.controller.js';
import { UserPreferencesService } from '../service/user-preferences.service.js';
import { UserPreferenceSettingsService } from '../service/user-preference-settings.service.js';

test('真实 Nest 偏好路由执行认证、schema、默认值及错误映射', async () => {
  const ownerId = '54b8b9fc-9d24-49e8-9d28-b52bff3fa110';
  const resourceId = '54b8b9fc-9d24-49e8-9d28-b52bff3fa111';
  const calls: unknown[] = [];
  let enabled = true;
  const preferences = {
    list: async (userId: string, query: unknown) => {
      calls.push({ userId, query });
      return { items: [], total: 0, ...(query as object) };
    },
    create: async (userId: string, input: object) => ({ userId, ...input }),
    update: async (userId: string, id: string, input: object) => {
      if (userId !== ownerId || id !== resourceId) {
        throw new NotFoundException('偏好不存在');
      }
      return { id, ...input };
    },
    delete: async () => {},
    deleteAll: async () => ({ deletedCount: 0 }),
  };
  const settings = {
    getSettings: async () => ({ enabled, updatedAt: new Date().toISOString() }),
    updateSettings: async (_userId: string, input: { enabled: boolean }) => {
      enabled = input.enabled;
      return { enabled, updatedAt: new Date().toISOString() };
    },
  };
  @Module({
    controllers: [UserPreferencesController],
    providers: [
      { provide: UserPreferencesService, useValue: preferences },
      { provide: UserPreferenceSettingsService, useValue: settings },
    ],
  })
  class HttpFixtureModule {}

  const app = await NestFactory.create(HttpFixtureModule, { logger: false });
  const jwt = new JwtService({ secret: 'preference-http-test-secret' });
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
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    auth = token,
  ) {
    return fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  try {
    assert.equal(
      (await request('/preferences', 'GET', undefined, '')).status,
      401,
    );
    let response = await request('/preferences?page=2&pageSize=3');
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0], {
      userId: ownerId,
      query: { page: 2, pageSize: 3 },
    });
    assert.equal((await request('/preferences?extra=true')).status, 400);
    assert.equal((await request('/preferences?page=0')).status, 400);
    response = await request('/preferences', 'POST', {
      category: 'style',
      value: { items: [' 通勤 '] },
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      userId: ownerId,
      category: 'style',
      value: { items: ['通勤'] },
      isPrimary: false,
    });
    for (const body of [
      { category: 'style', value: { items: ['通勤'], extra: true } },
      { category: 'shoe_size', value: { value: 61, system: 'CN' } },
      { category: 'style', value: { items: ['通勤'] }, userId: 'other' },
    ]) {
      assert.equal((await request('/preferences', 'POST', body)).status, 400);
    }
    assert.equal(
      (await request('/preferences/settings', 'PATCH', { enabled: 'false' }))
        .status,
      400,
    );
    assert.equal(
      (
        await request('/preferences/settings', 'PATCH', {
          enabled: false,
          userId: ownerId,
        })
      ).status,
      400,
    );
    response = await request('/preferences/settings', 'PATCH', {
      enabled: false,
    });
    assert.equal(response.status, 200);
    assert.equal(
      ((await response.json()) as { enabled: boolean }).enabled,
      false,
    );
    assert.equal((await request('/preferences/settings')).status, 200);
    assert.equal(
      (await request('/preferences/not-a-uuid', 'PATCH', { isPrimary: true }))
        .status,
      400,
    );
    assert.equal(
      (await request(`/preferences/${resourceId}`, 'PATCH', {})).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/preferences/54b8b9fc-9d24-49e8-9d28-b52bff3fa112',
          'PATCH',
          { isPrimary: true },
        )
      ).status,
      404,
    );
    const otherToken = await jwt.signAsync({ sub: 'other-user' });
    assert.equal(
      (
        await request(
          `/preferences/${resourceId}`,
          'PATCH',
          { isPrimary: true },
          otherToken,
        )
      ).status,
      404,
    );
    assert.equal(
      (await request('/preferences', 'DELETE', { confirm: false })).status,
      400,
    );
    assert.equal(
      (await request('/preferences', 'DELETE', { confirm: true })).status,
      200,
    );
    assert.equal((await request('/memories')).status, 404);
    assert.equal((await request(`/memories/${resourceId}`)).status, 404);
  } finally {
    await app.close();
  }
});
