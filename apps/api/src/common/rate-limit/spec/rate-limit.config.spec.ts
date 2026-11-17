import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRateLimitConfig } from '../rate-limit.config.js';

test('限流配置使用默认值并返回毫秒 TTL', () => {
  assert.deepEqual(parseRateLimitConfig({}), {
    defaultTtl: 60_000,
    defaultLimit: 120,
    authTtl: 60_000,
    authLimit: 10,
  });
});

test('限流配置读取环境变量并拒绝非正整数', () => {
  assert.deepEqual(
    parseRateLimitConfig({
      RATE_LIMIT_TTL_MS: '1000',
      RATE_LIMIT_LIMIT: '20',
      AUTH_RATE_LIMIT_TTL_MS: 5000,
      AUTH_RATE_LIMIT_LIMIT: 3,
    }),
    {
      defaultTtl: 1000,
      defaultLimit: 20,
      authTtl: 5000,
      authLimit: 3,
    },
  );
  assert.throws(
    () =>
      parseRateLimitConfig({
        RATE_LIMIT_LIMIT: '0',
      }),
    /RATE_LIMIT_LIMIT 必须是正整数/,
  );
});
