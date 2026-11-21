import { Inject, Injectable } from '@nestjs/common';
import { create } from 'svg-captcha';

import {
  type CaptchaChallenge,
  type CaptchaProvider,
} from '../captcha-provider.js';
import {
  CaptchaChallengeStore,
  type CaptchaChallengeStorePort,
} from './captcha-challenge.store.js';

@Injectable()
export class ImageCaptchaProvider implements CaptchaProvider {
  public constructor(
    @Inject(CaptchaChallengeStore)
    private readonly challenges: CaptchaChallengeStorePort,
  ) {}

  public async issueChallenge(): Promise<CaptchaChallenge> {
    const captcha = create({
      size: 5,
      charPreset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
      noise: 2,
      color: false,
      background: '#ffffff',
    });
    const challengeId = this.challenges.createId();
    await this.challenges.save(challengeId, captcha.text);

    return {
      challengeId,
      imageData: `data:image/svg+xml;base64,${Buffer.from(captcha.data).toString('base64')}`,
      type: 'image',
    };
  }

  public async verifyChallenge(
    challengeId: string,
    answer: string,
  ): Promise<boolean> {
    return this.challenges.consume(challengeId, answer);
  }
}
