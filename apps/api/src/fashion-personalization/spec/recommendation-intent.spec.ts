import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendationIntentSchema } from '../context/recommendation-intent.schema.js';

test('推荐意图默认同时返回单品和整套，并拒绝未知字段', () => {
  const parsed = recommendationIntentSchema.parse({
    styles: ['复古'],
    budgetMax: 500,
  });
  assert.equal(parsed.mode, 'both');
  assert.equal(parsed.inStock, true);
  assert.equal(
    recommendationIntentSchema.safeParse({
      styles: ['复古'],
      unexpected: true,
    }).success,
    false,
  );
});

test('推荐意图拒绝反向预算和重复槽位', () => {
  assert.equal(
    recommendationIntentSchema.safeParse({
      budgetMin: 600,
      budgetMax: 500,
    }).success,
    false,
  );
  assert.equal(
    recommendationIntentSchema.safeParse({
      requestedSlots: ['tops', 'tops'],
    }).success,
    false,
  );
});
