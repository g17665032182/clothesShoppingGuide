import assert from 'node:assert/strict';
import test from 'node:test';

import { StandardSchemaValidationPipe } from '@nestjs/common';

import { adminUpdateUserSchema } from '../dto/admin-update-user.dto.js';
import { updateProfileSchema } from '../dto/update-profile.dto.js';
import { userIdSchema } from '../dto/user-id.dto.js';

test('用户资料 schema 接受允许的更新并拒绝 null 和未知字段', () => {
  assert.deepEqual(updateProfileSchema.parse({ displayName: '春日衣橱' }), {
    displayName: '春日衣橱',
  });
  assert.equal(
    updateProfileSchema.safeParse({ displayName: null }).success,
    false,
  );
  assert.equal(updateProfileSchema.safeParse({ role: 'admin' }).success, false);
});

test('管理员用户 schema 只接受契约中定义的字段和值', () => {
  assert.equal(
    adminUpdateUserSchema.safeParse({ role: 'admin', status: 'active' })
      .success,
    true,
  );
  assert.equal(
    adminUpdateUserSchema.safeParse({ role: 'owner' }).success,
    false,
  );
  assert.equal(
    adminUpdateUserSchema.safeParse({ password: 'secret' }).success,
    false,
  );
});

test('用户 ID 路径参数使用 UUID schema 校验', () => {
  assert.equal(
    userIdSchema.safeParse('9c2c6f3b-4d12-4a9e-8c0a-8d6d0a8b8c1e').success,
    true,
  );
  assert.equal(userIdSchema.safeParse('not-a-uuid').success, false);
});

test('用户请求 schema 由 Nest 标准 pipe 转换和校验', async () => {
  const pipe = new StandardSchemaValidationPipe();

  await assert.rejects(
    pipe.transform(
      { displayName: '春日衣橱', unexpected: true },
      { type: 'body', schema: updateProfileSchema },
    ),
  );
});
