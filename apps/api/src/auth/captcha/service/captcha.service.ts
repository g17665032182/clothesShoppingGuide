import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CAPTCHA_PROVIDER,
  type CaptchaChallenge,
  type CaptchaProvider,
} from '../captcha-provider.js';

@Injectable()
export class CaptchaService {
  public constructor(
    private readonly config: ConfigService,
    @Inject(CAPTCHA_PROVIDER)
    private readonly provider: CaptchaProvider,
  ) {}

  public isEnabled(): boolean {
    const environment = this.config.get<string>('NODE_ENV');
    return environment === 'test' || environment === 'production';
  }

  public async issueLoginChallenge(): Promise<CaptchaChallenge> {
    if (!this.isEnabled()) {
      throw new NotFoundException('当前环境未启用登录验证码');
    }

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
