import assert from 'node:assert/strict';
import test from 'node:test';

import { StandardSchemaValidationPipe } from '@nestjs/common';

import {
  createTryOnTaskSchema,
  tryOnTaskQuerySchema,
} from '../dto/try-on-task.dto.js';
import { emptyTryOnActionSchema } from '../dto/try-on-param.dto.js';
import { photoSaveSchema } from '../dto/try-on-photo.dto.js';

test('试穿任务 schema 拒绝未知字段并规范化文本', () => {
  const valid = createTryOnTaskSchema.safeParse({
    productExternalId: ' product-1 ',
    color: ' 黑色 ',
    photoId: '00000000-0000-4000-8000-000000000001',
    consentVersion: 'v1',
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.productExternalId, 'product-1');
    assert.equal(valid.data.color, '黑色');
  }

  assert.equal(
    createTryOnTaskSchema.safeParse({
      productExternalId: 'product-1',
      color: '黑色',
      photoId: '00000000-0000-4000-8000-000000000001',
      consentVersion: 'v1',
      userId: 'other-user',
    }).success,
    false,
  );
});

test('查询 schema 支持默认分页和布尔转换', () => {
  const result = tryOnTaskQuerySchema.parse({
    unread: 'true',
    page: '2',
  });
  assert.deepEqual(result, {
    page: 2,
    pageSize: 20,
    unread: true,
  });
});

test('multipart save 字段默认 false 且空对象被拒绝', () => {
  assert.deepEqual(photoSaveSchema.parse({}), { save: false });
  assert.deepEqual(photoSaveSchema.parse({ save: '1' }), { save: true });
  assert.equal(
    emptyTryOnActionSchema.safeParse({ extra: true }).success,
    false,
  );
});

test('Nest StandardSchemaValidationPipe 映射非法试穿 Body 为 400', async () => {
  const pipe = new StandardSchemaValidationPipe();
  await assert.rejects(
    () =>
      pipe.transform(
        {
          productExternalId: '',
          color: '黑色',
          photoId: 'invalid',
          consentVersion: 'v1',
        },
        {
          type: 'body',
          metatype: undefined,
          data: undefined,
          schema: createTryOnTaskSchema,
        },
      ),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      (error as { getStatus: () => number }).getStatus() === 400,
  );
});
