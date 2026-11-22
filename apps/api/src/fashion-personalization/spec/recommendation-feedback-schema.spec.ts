import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BadRequestException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';

import { recommendationFeedbackSchema } from '../dto/recommendation-feedback.dto.js';
import { recommendationProfileClearSchema } from '../dto/recommendation-profile-clear.dto.js';
import { recommendationSettingsSchema } from '../dto/recommendation-settings.dto.js';

const base = {
  recommendationId: '00000000-0000-4000-8000-000000000001',
  conversationId: '00000000-0000-4000-8000-000000000002',
  assistantMessageId: '00000000-0000-4000-8000-000000000003',
  targetType: 'item' as const,
  targetRef: 'item-1',
};

test('推荐反馈 schema 拒绝未知字段和不匹配原因', async () => {
  const pipe = new StandardSchemaValidationPipe();
  const metadata = {
    type: 'body' as const,
    schema: recommendationFeedbackSchema,
  };
  assert.deepEqual(
    await pipe.transform(
      { ...base, feedbackType: 'negative', reasonCode: 'price' },
      metadata,
    ),
    { ...base, feedbackType: 'negative', reasonCode: 'price' },
  );
  await assert.rejects(
    pipe.transform(
      { ...base, feedbackType: 'positive', reasonCode: 'price' },
      metadata,
    ),
    BadRequestException,
  );
  await assert.rejects(
    pipe.transform(
      { ...base, feedbackType: 'positive', extra: true },
      metadata,
    ),
    BadRequestException,
  );
});

test('推荐设置和清空 schema 只接受严格对象', async () => {
  const pipe = new StandardSchemaValidationPipe();
  assert.deepEqual(
    await pipe.transform(
      { enabled: false },
      { type: 'body' as const, schema: recommendationSettingsSchema },
    ),
    { enabled: false },
  );
  assert.deepEqual(
    await pipe.transform(
      { confirm: true },
      { type: 'body' as const, schema: recommendationProfileClearSchema },
    ),
    { confirm: true },
  );
  await assert.rejects(
    pipe.transform(
      { confirm: false },
      { type: 'body' as const, schema: recommendationProfileClearSchema },
    ),
    BadRequestException,
  );
});
