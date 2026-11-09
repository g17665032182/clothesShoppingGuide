import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BadRequestException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';

import { adminProductQuerySchema } from '../dto/admin-product-query.dto.js';
import { adminProductIdSchema } from '../dto/admin-product-id.dto.js';
import { adminProductTryOnUpdateSchema } from '../dto/admin-product-try-on.dto.js';

test('管理员商品查询默认分页并严格转换布尔参数', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(adminProductQuerySchema.parse({}))),
    { page: 1, pageSize: 20 },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        adminProductQuerySchema.parse({
          page: '2',
          pageSize: '50',
          isActive: 'false',
          inStock: 'true',
          keyword: ' 大衣 ',
        }),
      ),
    ),
    { page: 2, pageSize: 50, isActive: false, inStock: true, keyword: '大衣' },
  );
  for (const input of [
    { page: '' },
    { page: null },
    { page: '-1' },
    { page: '1.5' },
    { pageSize: '101' },
    { keyword: '' },
    { keyword: '\u0000' },
    { isActive: '0' },
    { isActive: false },
    { inStock: 'yes' },
    { category: 'bags' },
    { unexpected: 'value' },
  ])
    assert.equal(adminProductQuerySchema.safeParse(input).success, false);
});

test('管理员试穿设置只接受必填严格布尔，并由标准 Pipe 映射400', async () => {
  const pipe = new StandardSchemaValidationPipe();
  for (const tryOnEnabled of [true, false]) {
    assert.deepEqual(adminProductTryOnUpdateSchema.parse({ tryOnEnabled }), {
      tryOnEnabled,
    });
  }
  for (const input of [
    {},
    { tryOnEnabled: 'true' },
    { tryOnEnabled: 'false' },
    { tryOnEnabled: 1 },
    { tryOnEnabled: 0 },
    { tryOnEnabled: null },
    { tryOnEnabled: true, isActive: false },
    null,
  ]) {
    assert.equal(adminProductTryOnUpdateSchema.safeParse(input).success, false);
    await assert.rejects(
      pipe.transform(input, {
        type: 'body',
        schema: adminProductTryOnUpdateSchema,
      }),
      BadRequestException,
    );
  }
});

test('管理员商品 UUID Param 和标准 Pipe 拒绝非法边界', async () => {
  const pipe = new StandardSchemaValidationPipe();
  assert.equal(
    adminProductIdSchema.safeParse({ id: 'not-uuid' }).success,
    false,
  );
  assert.equal(
    adminProductIdSchema.safeParse({
      id: '54b8b9fc-9d24-49e8-9d28-b52bff3fa110',
      extra: 1,
    }).success,
    false,
  );
  await assert.rejects(
    pipe.transform(
      { page: '0' },
      { type: 'query', schema: adminProductQuerySchema },
    ),
    BadRequestException,
  );
});
