import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BadRequestException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';

import { adminProductQuerySchema } from '../dto/admin-product-query.dto.js';
import { adminProductIdSchema } from '../dto/admin-product-id.dto.js';

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
