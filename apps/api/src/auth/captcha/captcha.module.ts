import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { CAPTCHA_PROVIDER } from './captcha-provider.js';
import { CaptchaChallengeStore } from './service/captcha-challenge.store.js';
import { CaptchaService } from './service/captcha.service.js';
import { ImageCaptchaProvider } from './service/image-captcha.provider.js';
import { RedisCaptchaChallengeStore } from './service/redis-captcha-challenge.store.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CaptchaChallengeStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const storage = config.get<string>('CAPTCHA_STORAGE', 'memory');
        if (storage === 'memory') return new CaptchaChallengeStore();
        if (storage === 'redis') {
          return new RedisCaptchaChallengeStore(config);
        }
        throw new Error(`Unsupported CAPTCHA_STORAGE: ${storage}`);
      },
    },
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
