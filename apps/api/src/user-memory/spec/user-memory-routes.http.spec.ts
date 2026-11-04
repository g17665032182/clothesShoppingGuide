import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConflictException,
  Module,
  ServiceUnavailableException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { UserMemoryDocumentController } from '../controller/user-memory-document.controller.js';
import { UserMemorySettingsController } from '../controller/user-memory-settings.controller.js';
import { UserMemoryDocumentService } from '../service/user-memory-document.service.js';
import { UserMemorySettingsService } from '../service/user-memory-settings.service.js';
import type { UpdateMemoryDocumentInput } from '../dto/user-memory-document.dto.js';

test('真实 Nest 记忆路由：认证、用户隔离、严格校验、冲突与独立开关', async () => {
  const documents = new Map<
    string,
    { content: string; revision: number; updatedAt: null }
  >();
  const enabled = new Map<string, boolean>();
  let unavailable = false;
  const documentService = {
    get: async (id: string) => {
      if (unavailable) throw new ServiceUnavailableException();
      return documents.get(id) ?? { content: '', revision: 0, updatedAt: null };
    },
    update: async (id: string, input: UpdateMemoryDocumentInput) => {
      const current = await documentService.get(id);
      if (current.revision !== input.expectedRevision)
        throw new ConflictException();
      const next = {
        content: input.content,
        revision: current.revision + 1,
        updatedAt: null,
      };
      documents.set(id, next);
      return next;
    },
    clear: async (id: string) => {
      documents.delete(id);
    },
  };
  const settingsService = {
    get: async (id: string) => ({
      enabled: enabled.get(id) ?? true,
      updatedAt: new Date(0).toISOString(),
    }),
    update: async (id: string, input: { enabled: boolean }) => {
      enabled.set(id, input.enabled);
      return settingsService.get(id);
    },
  };
  // tsx 不产生构造器元数据，测试显式补入生产编译器会生成的信息。
  Reflect.defineMetadata(
    'design:paramtypes',
    [UserMemoryDocumentService],
    UserMemoryDocumentController,
  );
  Reflect.defineMetadata(
    'design:paramtypes',
    [UserMemorySettingsService],
    UserMemorySettingsController,
  );
  @Module({
    controllers: [UserMemoryDocumentController, UserMemorySettingsController],
    providers: [
      { provide: UserMemoryDocumentService, useValue: documentService },
      { provide: UserMemorySettingsService, useValue: settingsService },
    ],
  })
  class TestMemoryModule {}
  const app = await NestFactory.create(TestMemoryModule, { logger: false });
  const jwt = new JwtService({ secret: 'memory-http-test-only-secret' });
  app.useGlobalGuards(
    new JwtAuthGuard(jwt, new Reflector(), {
      findActiveById: async (id: string) =>
        ['owner', 'other'].includes(id) ? { id } : null,
    } as never),
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    user = 'owner',
  ) =>
    fetch(`${base}/api/${path}`, {
      method,
      headers: {
        ...(user ? { Authorization: `Bearer ${jwt.sign({ sub: user })}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal(
      (await request('memories/document', 'GET', undefined, '')).status,
      401,
    );
    assert.equal(
      (await request('memories/document', 'GET', undefined, 'disabled')).status,
      401,
    );
    assert.equal((await request('memories/settings')).status, 200);
    assert.equal(
      (await request('memories/settings', 'PATCH', { enabled: 'false' }))
        .status,
      400,
    );
    assert.equal(
      (
        await request('memories/settings', 'PATCH', {
          enabled: false,
          userId: 'other',
        })
      ).status,
      400,
    );
    assert.equal(
      (await request('memories/settings', 'PATCH', { enabled: false })).status,
      200,
    );
    for (const body of [
      { content: '穿搭', expectedRevision: -1 },
      { content: '穿搭', expectedRevision: 0, userId: 'other' },
      { content: '\ud800', expectedRevision: 0 },
      { content: '我的密码 secret', expectedRevision: 0 },
      { content: 'a'.repeat(32769), expectedRevision: 0 },
    ])
      assert.equal(
        (await request('memories/document', 'PUT', body)).status,
        400,
      );
    const saved = await request('memories/document', 'PUT', {
      content: '长期喜欢棉质衣物',
      expectedRevision: 0,
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), {
      content: '长期喜欢棉质衣物',
      revision: 1,
      updatedAt: null,
    });
    assert.equal(
      (
        await request('memories/document', 'PUT', {
          content: '旧版本',
          expectedRevision: 0,
        })
      ).status,
      409,
    );
    assert.deepEqual(
      await (
        await request('memories/document', 'GET', undefined, 'other')
      ).json(),
      {
        content: '',
        revision: 0,
        updatedAt: null,
      },
    );
    unavailable = true;
    assert.equal((await request('memories/document')).status, 503);
    unavailable = false;
    assert.equal((await request('memories')).status, 404);
    assert.equal(
      (
        await request(
          'memories/00000000-0000-0000-0000-000000000000',
          'PATCH',
          {},
        )
      ).status,
      404,
    );
    assert.equal((await request('memories/document', 'DELETE')).status, 204);
  } finally {
    await app.close();
  }
});
