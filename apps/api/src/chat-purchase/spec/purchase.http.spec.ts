import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { ChatPurchaseController } from '../controller/chat-purchase.controller.js';
import { PurchaseDraftService } from '../service/purchase-draft.service.js';
import { PurchaseConfirmationService } from '../service/purchase-confirmation.service.js';

test('Nest 购买路由：JWT、严格 Body/Query/Param 及首次/重试状态码', async () => {
  let count = 0;
  const userId = randomUUID(),
    conversationId = randomUUID(),
    draftId = randomUUID();
  const path = `/chat/conversations/${conversationId}/purchase-draft`;
  const drafts = {
    read: async () => ({ draft: null, order: null }),
    start: async (_user: string, _conversation: string, input: unknown) => ({
      draft: input,
      order: null,
    }),
    patch: async (
      _user: string,
      _conversation: string,
      _draft: string,
      input: unknown,
    ) => input,
  };
  @Module({
    controllers: [ChatPurchaseController],
    providers: [
      { provide: PurchaseDraftService, useValue: drafts },
      {
        provide: PurchaseConfirmationService,
        useValue: {
          confirm: async () => ({
            created: ++count === 1,
            draft: { id: draftId },
            order: { id: randomUUID() },
          }),
        },
      },
    ],
  })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false });
  const jwt = new JwtService({ secret: 'purchase-http-fixture' });
  app.useGlobalGuards(
    new JwtAuthGuard(jwt, new Reflector(), {
      findActiveById: async (id: string) => (id === userId ? { id } : null),
    } as never),
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const token = await jwt.signAsync({ sub: userId });
  const request = (url: string, method = 'GET', body?: unknown, auth = token) =>
    fetch(`${base}${url}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    assert.equal((await request(path, 'GET', undefined, '')).status, 401);
    assert.equal(
      (
        await request(
          path,
          'GET',
          undefined,
          await jwt.signAsync({ sub: randomUUID() }),
        )
      ).status,
      401,
    );
    assert.equal((await request(`${path}?unknown=true`)).status, 400);
    assert.equal(
      (await request(path.replace(conversationId, 'invalid'))).status,
      400,
    );
    assert.equal(
      (
        await request(`${path}/start`, 'POST', {
          productExternalId: 'x',
          expectedVersion: null,
          price: '1.00',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(`${path}/${draftId}`, 'PATCH', {
          expectedVersion: 1,
          recipient: {},
        })
      ).status,
      400,
    );
    const start = await request(`${path}/start`, 'POST', {
      productExternalId: ' fixture ',
      expectedVersion: null,
    });
    assert.equal(start.status, 200);
    assert.equal(
      ((await start.json()) as { draft: { productExternalId: string } }).draft
        .productExternalId,
      'fixture',
    );
    for (const status of [201, 200]) {
      assert.equal(
        (
          await request(`${path}/${draftId}/confirm`, 'POST', {
            expectedVersion: 1,
          })
        ).status,
        status,
      );
    }
  } finally {
    await app.close();
  }
});
