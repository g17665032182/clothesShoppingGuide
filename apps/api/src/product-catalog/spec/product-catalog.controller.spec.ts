import assert from 'node:assert/strict';
import test from 'node:test';

import { StandardSchemaValidationPipe } from '@nestjs/common';

import {
  nextPageSchema,
  ProductCatalogController,
} from '../controller/product-catalog.controller.js';

test('下一页请求严格校验筛选条件和游标，并复用商品查询服务', async () => {
  const calls: unknown[][] = [];
  const service = {
    async getNextPage(...args: unknown[]) {
      calls.push(args);
      return { items: [], nextCursor: null, noResultReason: null };
    },
  };
  const controller = new ProductCatalogController(service as never);
  const pipe = new StandardSchemaValidationPipe();
  const input = (await pipe.transform(
    {
      query: { size: 'M', limit: 3 },
      cursor: 'signed-cursor',
    },
    { type: 'body', schema: nextPageSchema },
  )) as Parameters<typeof controller.nextPage>[0];

  await controller.nextPage(input);
  assert.deepEqual(calls, [[{ size: 'M', limit: 3 }, 'signed-cursor']]);
  await assert.rejects(
    pipe.transform(
      {
        query: { size: 'M', limit: 20 },
        cursor: 'signed-cursor',
      },
      { type: 'body', schema: nextPageSchema },
    ),
    /Bad Request Exception/u,
  );
  await assert.rejects(
    pipe.transform(
      {
        query: { size: 'M', limit: 3 },
        cursor: 'signed-cursor',
        userId: 'injected',
      },
      { type: 'body', schema: nextPageSchema },
    ),
    /Bad Request Exception/u,
  );
});
