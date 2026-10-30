import assert from 'node:assert/strict';
import test from 'node:test';

import { CaptchaChallengeStore } from '../captcha/service/captcha-challenge.store.js';
import { ImageCaptchaProvider } from '../captcha/service/image-captcha.provider.js';

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
