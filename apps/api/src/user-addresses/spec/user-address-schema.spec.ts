import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BadRequestException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';

import {
  addressIdSchema,
  createUserAddressSchema,
  listUserAddressesQuerySchema,
  updateUserAddressSchema,
} from '../dto/user-address.schema.js';

test('地址创建 schema trim 输入、默认非默认并拒绝未知字段', () => {
  const input = {
    requestKey: 'acdc9a72-d0e3-4e22-8cd2-cc5a671a6bb4',
    recipientName: ' 张三 ',
    phone: '+8613800138000',
    address: ' 上海市浦东新区 ',
  };
  assert.deepEqual(createUserAddressSchema.parse(input), {
    ...input,
    recipientName: '张三',
    address: '上海市浦东新区',
    isDefault: false,
  });
  for (const invalid of [
    { ...input, requestKey: 'bad' },
    { ...input, phone: '13800' },
    { ...input, recipientName: '\u0000' },
    { ...input, unexpected: true },
  ]) {
    assert.equal(createUserAddressSchema.safeParse(invalid).success, false);
  }
});

test('地址更新 schema 拒绝空对象、未知字段并允许清空标签', () => {
  assert.equal(updateUserAddressSchema.safeParse({}).success, false);
  assert.equal(
    updateUserAddressSchema.safeParse({ unexpected: true }).success,
    false,
  );
  assert.deepEqual(updateUserAddressSchema.parse({ label: null }), {
    label: null,
  });
});

test('地址列表查询进行默认值和边界转换，路径使用 UUID', async () => {
  assert.deepEqual(listUserAddressesQuerySchema.parse({}), {
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(
    listUserAddressesQuerySchema.parse({ page: '2', pageSize: '100' }),
    { page: 2, pageSize: 100 },
  );
  assert.equal(
    listUserAddressesQuerySchema.safeParse({ page: '0' }).success,
    false,
  );
  assert.equal(
    addressIdSchema.safeParse({ id: 'acdc9a72-d0e3-4e22-8cd2-cc5a671a6bb4' })
      .success,
    true,
  );
  const pipe = new StandardSchemaValidationPipe();
  await assert.rejects(
    pipe.transform(
      { requestKey: 'bad' },
      { type: 'body', schema: createUserAddressSchema },
    ),
    BadRequestException,
  );
  await assert.rejects(
    pipe.transform(
      { page: '1', unexpected: 'x' },
      { type: 'query', schema: listUserAddressesQuerySchema },
    ),
    BadRequestException,
  );
});
