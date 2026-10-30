import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  CAPTCHA_PROVIDER,
  type CaptchaChallenge,
  type CaptchaProvider,
} from '../captcha-provider.js';

@Injectable()
export class CaptchaService {
  public constructor(
    @Inject(CAPTCHA_PROVIDER)
    private readonly provider: CaptchaProvider,
  ) {}

  public async issueLoginChallenge(): Promise<CaptchaChallenge> {
    try {
      return await this.provider.issueChallenge();
    } catch {
      throw new ServiceUnavailableException('暂时无法获取验证码，请稍后重试');
    }
  }

  public verifyLoginAnswer(
    challengeId: string,
    answer: string,
  ): Promise<boolean> {
    return this.provider.verifyChallenge(challengeId, answer);
  }
}
