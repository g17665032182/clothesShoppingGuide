import assert from 'node:assert/strict';
import test from 'node:test';

import { ZodError } from 'zod';

import { memoryCandidateSchema } from '../context/memory-candidate.schema.js';
import { containsSensitiveMemoryText } from '../context/memory-safety.js';
import {
  listMemoryQuerySchema,
  updateMemorySchema,
} from '../dto/user-memory.dto.js';
import {
  MEMORY_TASK_MAX_ATTEMPTS,
  memoryTaskCanRetry,
  memoryTaskRetryDelay,
} from '../task/memory-task-backoff.js';
import { formatMemoryContext } from '../context/memory-context.formatter.js';

test('记忆列表 Query 默认分页并拒绝未声明字段', () => {
  const query = listMemoryQuerySchema.parse({});

  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 20);
  assert.throws(
    () => listMemoryQuerySchema.parse({ unexpected: 'value' }),
    ZodError,
  );
  assert.throws(() => listMemoryQuerySchema.parse({ page: '0' }), ZodError);
  assert.throws(
    () => listMemoryQuerySchema.parse({ pageSize: '101' }),
    ZodError,
  );
});

test('记忆更新必须包含有效字段且拒绝未知字段', () => {
  assert.throws(() => updateMemorySchema.parse({}), ZodError);
  assert.throws(
    () => updateMemorySchema.parse({ isPrimary: true, unknown: true }),
    ZodError,
  );
  assert.deepEqual(updateMemorySchema.parse({ isPrimary: true }), {
    isPrimary: true,
  });
});

test('模型候选必须符合严格结构和类别值 schema', () => {
  assert.deepEqual(
    memoryCandidateSchema.parse({
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
      memoryCandidateSchema.parse({
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
    () => memoryCandidateSchema.parse({ operations: [], extra: true }),
    ZodError,
  );
});

test('敏感文本会被识别，安全的服装偏好不会误拦截', () => {
  assert.equal(
    containsSensitiveMemoryText({
      items: ['深蓝色', 'sk-abcdefghijklmnop'],
    }),
    true,
  );
  assert.equal(
    containsSensitiveMemoryText({ notes: '喜欢宽松版型和纯棉面料' }),
    false,
  );
});

test('记忆上下文包含当前消息优先级和不可执行数据规则', () => {
  const context = formatMemoryContext([
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

test('提取任务按约定退避，第四次后停止重试', () => {
  assert.equal(MEMORY_TASK_MAX_ATTEMPTS, 4);
  assert.equal(memoryTaskRetryDelay(1), 60_000);
  assert.equal(memoryTaskRetryDelay(2), 5 * 60_000);
  assert.equal(memoryTaskRetryDelay(3), 30 * 60_000);
  assert.equal(memoryTaskRetryDelay(4), 30 * 60_000);
  assert.equal(memoryTaskCanRetry(3), true);
  assert.equal(memoryTaskCanRetry(4), false);
});
