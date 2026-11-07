import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { OrdersController } from '../controller/orders.controller.js';
import { OrdersService } from '../service/orders.service.js';

const ownerId = '54b8b9fc-9d24-49e8-9d28-b52bff3fa110';
const skuId = '54b8b9fc-9d24-49e8-9d28-b52bff3fa111';

function plain<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

test('真实 Nest 订单路由校验登录/请求并按幂等结果返回状态码', async () => {
  const creates: Array<{ userId: string; input: unknown }> = [];
  let createCount = 0;
  const orders = {
    async createForUser(userId: string, input: unknown) {
      creates.push({ userId, input });
      createCount += 1;
      return {
        created: createCount === 1,
        order: {
          id: '54b8b9fc-9d24-49e8-9d28-b52bff3fa112',
          status: 'pending_payment',
          paymentMode: 'simulated',
        },
      };
    },
    async listForUser(userId: string, query: unknown) {
      return { items: [], total: 0, page: 1, pageSize: 20, userId, query };
    },
  };

  @Module({
    controllers: [OrdersController],
    providers: [{ provide: OrdersService, useValue: orders }],
  })
  class OrdersHttpFixtureModule {}

  const app = await NestFactory.create(OrdersHttpFixtureModule, {
    logger: false,
  });
  const jwt = new JwtService({ secret: 'orders-http-test-secret' });
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
    assert.equal((await request('/orders', 'GET', undefined, '')).status, 401);
    assert.equal(
      (
        await request('/orders', 'POST', {
          idempotencyKey: '54b8b9fc-9d24-49e8-9d28-b52bff3fa113',
          items: [{ skuId, quantity: 1 }],
          recipient: {
            name: '林女士',
            phone: '13800138000',
            address: '上海市示例地址 1 号',
          },
          amount: '0.01',
        })
      ).status,
      400,
    );

    const input = {
      idempotencyKey: '54b8b9fc-9d24-49e8-9d28-b52bff3fa113',
      items: [{ skuId, quantity: 1 }],
      recipient: {
        name: ' 林女士 ',
        phone: '13800138000',
        address: ' 上海市示例地址 1 号 ',
      },
    };
    let response = await request('/orders', 'POST', input);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      id: '54b8b9fc-9d24-49e8-9d28-b52bff3fa112',
      status: 'pending_payment',
      paymentMode: 'simulated',
    });
    response = await request('/orders', 'POST', input);
    assert.equal(response.status, 200);
    assert.deepEqual(
      creates.map(({ userId }) => userId),
      [ownerId, ownerId],
    );
    assert.deepEqual(plain(creates[0]?.input), {
      ...input,
      recipient: {
        name: '林女士',
        phone: '13800138000',
        address: '上海市示例地址 1 号',
      },
    });

    response = await request('/orders?page=2&pageSize=5');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      userId: ownerId,
      query: { page: 2, pageSize: 5 },
    });
  } finally {
    await app.close();
  }
});
