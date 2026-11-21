import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

import type { CaptchaChallengeStorePort } from './captcha-challenge.store.js';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const KEY_PREFIX = 'auth:captcha:v1:';
const MINIMUM_HMAC_SECRET_LENGTH = 32;

type RedisClient = RedisClientType;

/**
 * 多副本部署时使用 Redis 保存一次性挑战，避免验证码请求和登录请求落到不同 Pod 后失效。
 */
@Injectable()
export class RedisCaptchaChallengeStore
  implements CaptchaChallengeStorePort, OnModuleDestroy
{
  private readonly client: RedisClient;
  private readonly hmacSecret: string;
  private connectPromise: Promise<void> | undefined;

  public constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('CAPTCHA_REDIS_URL');
    const hmacSecret = this.config.get<string>('CAPTCHA_HMAC_SECRET');
    if (!redisUrl) {
      throw new Error(
        'CAPTCHA_REDIS_URL is required for Redis CAPTCHA storage',
      );
    }
    if (!hmacSecret || hmacSecret.length < MINIMUM_HMAC_SECRET_LENGTH) {
      throw new Error(
        `CAPTCHA_HMAC_SECRET must be at least ${MINIMUM_HMAC_SECRET_LENGTH} characters`,
      );
    }

    this.hmacSecret = hmacSecret;
    this.client = createClient({
      url: redisUrl,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: false,
      },
    });
    // node-redis 必须注册 error 监听，否则断连异常可能成为未捕获事件。
    this.client.on('error', () => undefined);
  }

  public createId(): string {
    return randomBytes(24).toString('base64url');
  }

  public async save(challengeId: string, answer: string): Promise<void> {
    await this.ensureConnected();
    let result: string | null;
    try {
      result = await this.client.set(
        this.key(challengeId),
        this.digest(challengeId, answer),
        {
          NX: true,
          EX: CHALLENGE_TTL_SECONDS,
        },
      );
    } catch {
      throw new ServiceUnavailableException('验证码服务暂不可用');
    }
    if (result !== 'OK') {
      throw new ServiceUnavailableException('验证码服务暂不可用');
    }
  }

  public async consume(challengeId: string, answer: string): Promise<boolean> {
    await this.ensureConnected();
    let expected: string | null;
    try {
      expected = await this.client.getDel(this.key(challengeId));
    } catch {
      throw new ServiceUnavailableException('验证码服务暂不可用');
    }
    if (!expected) return false;

    const actual = this.digest(challengeId, answer);
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(actual, 'hex');
    return expectedBuffer.length === actualBuffer.length
      ? timingSafeEqual(expectedBuffer, actualBuffer)
      : false;
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.client.isReady) {
      await this.client.quit();
    } else if (this.client.isOpen) {
      this.client.destroy();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;
    if (this.connectPromise) {
      try {
        await this.connectPromise;
      } catch {
        throw new ServiceUnavailableException('验证码服务暂不可用');
      }
      return;
    }
    if (this.client.isOpen) {
      this.client.destroy();
    }
    this.connectPromise = this.client
      .connect()
      .then(
        () => undefined,
        (error: unknown) => {
          throw error;
        },
      )
      .finally(() => {
        this.connectPromise = undefined;
      });
    try {
      await this.connectPromise;
    } catch {
      throw new ServiceUnavailableException('验证码服务暂不可用');
    }
  }

  private key(challengeId: string): string {
    return `${KEY_PREFIX}${challengeId}`;
  }

  private digest(challengeId: string, answer: string): string {
    return createHmac('sha256', this.hmacSecret)
      .update(challengeId)
      .update('\0')
      .update(answer.trim().toLowerCase())
      .digest('hex');
  }
}
