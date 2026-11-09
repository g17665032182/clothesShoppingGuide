import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';

import { CaptchaChallengeStore } from '../captcha/service/captcha-challenge.store.js';
import { CaptchaService } from '../captcha/service/captcha.service.js';
import { ImageCaptchaProvider } from '../captcha/service/image-captcha.provider.js';

test('验证码只在测试和生产环境启用', () => {
  for (const [environment, enabled] of [
    ['development', false],
    ['test', true],
    ['production', true],
    [undefined, false],
  ] as const) {
    const service = new CaptchaService(
      { get: () => environment } as never,
      {} as never,
    );
    assert.equal(service.isEnabled(), enabled, `${environment} 环境`);
  }
});

test('开发环境拒绝签发验证码挑战', async () => {
  let issueCount = 0;
  const service = new CaptchaService({ get: () => 'development' } as never, {
    issueChallenge: async () => {
      issueCount += 1;
      return { challengeId: 'unused', imageData: '', type: 'image' };
    },
    verifyChallenge: async () => false,
  });

  await assert.rejects(
    service.issueLoginChallenge(),
    (error: unknown) =>
      error instanceof NotFoundException && error.getStatus() === 404,
  );
  assert.equal(issueCount, 0);
});

test('图片验证码响应仅包含图片和挑战 ID，不包含答案', async () => {
  const provider = new ImageCaptchaProvider(new CaptchaChallengeStore());
  const challenge = await provider.issueChallenge();

  assert.ok(challenge.challengeId.length > 20);
  assert.match(challenge.imageData, /^data:image\/svg\+xml;base64,/);
  assert.equal(challenge.type, 'image');
  assert.equal('answer' in challenge, false);
  assert.equal(
    await provider.verifyChallenge(challenge.challengeId, 'incorrect'),
    false,
  );
  assert.equal(
    await provider.verifyChallenge(challenge.challengeId, 'incorrect'),
    false,
  );
});
