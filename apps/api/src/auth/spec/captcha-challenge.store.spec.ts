import assert from 'node:assert/strict';
import test from 'node:test';

import { CaptchaChallengeStore } from '../captcha/service/captcha-challenge.store.js';

test('验证码答案忽略首尾空白和大小写，且挑战只能消费一次', async () => {
  const store = new CaptchaChallengeStore();
  await store.save('challenge-id', 'AbC23');

  assert.equal(await store.consume('challenge-id', ' abc23 '), true);
  assert.equal(await store.consume('challenge-id', 'AbC23'), false);
});

test('错误答案也会消费挑战，避免重复猜测', async () => {
  const store = new CaptchaChallengeStore();
  await store.save('challenge-id', 'AbC23');

  assert.equal(await store.consume('challenge-id', 'wrong'), false);
  assert.equal(await store.consume('challenge-id', 'AbC23'), false);
});

test('验证码挑战到期后不能通过校验', async () => {
  const store = new CaptchaChallengeStore();
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;

  try {
    await store.save('challenge-id', 'AbC23');
    now += 5 * 60 * 1_000;

    assert.equal(await store.consume('challenge-id', 'AbC23'), false);
  } finally {
    Date.now = originalNow;
  }
});
