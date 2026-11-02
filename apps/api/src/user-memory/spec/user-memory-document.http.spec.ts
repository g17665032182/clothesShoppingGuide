import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';

import { updateMemoryDocumentSchema } from '../context/memory-document.schema.js';

test('文档更新 schema 由 Nest pipe 接受合法正文并拒绝未知字段', async () => {
  const pipe = new StandardSchemaValidationPipe();
  const metadata = {
    type: 'body' as const,
    schema: updateMemoryDocumentSchema,
  };
  assert.deepEqual(
    await pipe.transform(
      { content: '喜欢休闲装', expectedRevision: 0 },
      metadata,
    ),
    { content: '喜欢休闲装', expectedRevision: 0 },
  );
  for (const body of [
    { content: '内容', expectedRevision: 0, userId: 'other' },
    { content: '内容', expectedRevision: -1 },
    { content: '我的密码是 secret', expectedRevision: 0 },
    { content: '\ud800', expectedRevision: 0 },
  ]) {
    await assert.rejects(pipe.transform(body, metadata), BadRequestException);
  }
});
