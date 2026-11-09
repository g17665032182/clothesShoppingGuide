import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CAPTCHA_PROVIDER } from './captcha-provider.js';
import { CaptchaChallengeStore } from './service/captcha-challenge.store.js';
import { CaptchaService } from './service/captcha.service.js';
import { ImageCaptchaProvider } from './service/image-captcha.provider.js';

@Module({
  imports: [ConfigModule],
  providers: [
    CaptchaChallengeStore,
    ImageCaptchaProvider,
    {
      provide: CAPTCHA_PROVIDER,
      useExisting: ImageCaptchaProvider,
    },
    CaptchaService,
  ],
  exports: [CaptchaService],
})
export class CaptchaModule {}
