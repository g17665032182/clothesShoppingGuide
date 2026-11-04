import assert from 'node:assert/strict';
import test from 'node:test';
import {
  StandardSchemaValidationPipe,
  BadRequestException,
} from '@nestjs/common';

import { updateMemorySettingsSchema } from '../dto/memory-settings.dto.js';

test('记忆设置严格布尔值和独立 schema 通过标准 Pipe 绑定', async () => {
  const pipe = new StandardSchemaValidationPipe();
  const metadata = {
    type: 'body' as const,
    schema: updateMemorySettingsSchema,
  };
  assert.deepEqual(await pipe.transform({ enabled: false }, metadata), {
    enabled: false,
  });
  for (const value of [
    { enabled: 'false' },
    {},
    { enabled: true, userId: 'other' },
  ]) {
    await assert.rejects(pipe.transform(value, metadata), BadRequestException);
  }
});
