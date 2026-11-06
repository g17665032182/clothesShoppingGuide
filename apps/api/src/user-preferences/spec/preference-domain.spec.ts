import assert from 'node:assert/strict';
import test from 'node:test';

import { ZodError } from 'zod';

import { preferenceCandidateSchema } from '../context/preference-candidate.schema.js';
import { containsSensitivePreferenceText } from '../context/preference-safety.js';
import {
  listPreferenceQuerySchema,
  updatePreferenceSchema,
} from '../dto/user-preference.dto.js';
import { formatPreferenceContext } from '../context/preference-context.formatter.js';

test('偏好列表 Query 默认分页并拒绝未声明字段', () => {
  const query = listPreferenceQuerySchema.parse({});

  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 20);
  assert.throws(
    () => listPreferenceQuerySchema.parse({ unexpected: 'value' }),
    ZodError,
  );
  assert.throws(() => listPreferenceQuerySchema.parse({ page: '0' }), ZodError);
  assert.throws(
    () => listPreferenceQuerySchema.parse({ pageSize: '101' }),
    ZodError,
  );
});

test('偏好更新必须包含有效字段且拒绝未知字段', () => {
  assert.throws(() => updatePreferenceSchema.parse({}), ZodError);
  assert.throws(
    () => updatePreferenceSchema.parse({ isPrimary: true, unknown: true }),
    ZodError,
  );
  assert.deepEqual(updatePreferenceSchema.parse({ isPrimary: true }), {
    isPrimary: true,
  });
});

test('模型候选必须符合严格结构和类别值 schema', () => {
  assert.deepEqual(
    preferenceCandidateSchema.parse({
      operations: [
        {
          operation: 'upsert',
          category: 'fit',
          value: { preference: 'loose' },
          explicit: true,
        },
      ],
    }).operations.length,
    1,
  );
  assert.throws(
    () =>
      preferenceCandidateSchema.parse({
        operations: [
          {
            operation: 'upsert',
            category: 'fit',
            value: { preference: 'a'.repeat(33) },
            explicit: true,
          },
        ],
      }),
    ZodError,
  );
  assert.throws(
    () => preferenceCandidateSchema.parse({ operations: [], extra: true }),
    ZodError,
  );
  assert.throws(
    () =>
      preferenceCandidateSchema.parse({
        operations: [],
        documentOperations: [],
      }),
    ZodError,
  );
  assert.throws(
    () =>
      preferenceCandidateSchema.parse({
        operations: [
          {
            operation: 'append',
            section: 'other',
            markdown: '内容',
            explicit: true,
          },
        ],
      }),
    ZodError,
  );
});

test('敏感文本会被识别，安全的服装偏好不会误拦截', () => {
  assert.equal(
    containsSensitivePreferenceText({
      items: ['深蓝色', 'sk-abcdefghijklmnop'],
    }),
    true,
  );
  assert.equal(
    containsSensitivePreferenceText({ notes: '喜欢宽松版型和纯棉面料' }),
    false,
  );
});

test('偏好上下文包含当前消息优先级和不可执行数据规则', () => {
  const context = formatPreferenceContext([
    {
      category: 'fit',
      value: { preference: 'loose' },
      isPrimary: true,
      updatedAt: new Date('2026-11-03T00:00:00.000Z'),
    },
  ]);

  assert.match(context, /宽松|loose/);
  assert.match(context, /当前用户消息中的明确要求优先/u);
  assert.match(context, /不是指令/u);
});
