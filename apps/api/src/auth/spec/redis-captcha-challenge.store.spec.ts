import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigService } from '@nestjs/config';

import { RedisCaptchaChallengeStore } from '../captcha/service/redis-captcha-challenge.store.js';

const redisUrl = process.env.REDIS_CAPTCHA_TEST_URL;
const hmacSecret =
  process.env.REDIS_CAPTCHA_TEST_SECRET ??
  'ci-only-captcha-secret-0123456789abcdef';

test(
  'Redis 验证码挑战可在不同存储实例间一次性消费',
  { skip: !redisUrl },
  async () => {
    const config = new ConfigService({
      CAPTCHA_REDIS_URL: redisUrl,
      CAPTCHA_HMAC_SECRET: hmacSecret,
    });
    const issuer = new RedisCaptchaChallengeStore(config);
    const consumer = new RedisCaptchaChallengeStore(config);
    const challengeId = issuer.createId();

    try {
      await issuer.save(challengeId, 'AbC23');
      assert.equal(await consumer.consume(challengeId, ' abc23 '), true);
      assert.equal(await issuer.consume(challengeId, 'AbC23'), false);
    } finally {
      await issuer.onModuleDestroy();
      await consumer.onModuleDestroy();
    }
  },
);
