import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import mikroOrmConfig from './mikro-orm.config.js';
import { AuthModule } from './auth/auth.module.js';
import { ChatRecordsModule } from './chat-records/chat-records.module.js';
import { DbExceptionFilter } from './common/filter/db-exception.filter.js';
import { HealthModule } from './health/health.module.js';
import { LlmModule } from './llm/llm.module.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { UsersModule } from './users/users.module.js';
import { UserMemoryModule } from './user-memory/index.js';
import { UserPreferencesModule } from './user-preferences/index.js';
import { OrderCatalogCoordinationModule } from './order-catalog-coordination/order-catalog-coordination.module.js';
import { VirtualTryOnModule } from './virtual-try-on/virtual-try-on.module.js';
import { UserAddressesModule } from './user-addresses/index.js';
import { ReturnRefundModule } from './return-refund/index.js';
import { parseRateLimitConfig } from './common/rate-limit/rate-limit.config.js';
import { FashionPersonalizationModule } from './fashion-personalization/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: (config: Record<string, unknown>) => {
        const cursorSecret = config.PRODUCT_QUERY_CURSOR_SECRET;
        if (typeof cursorSecret !== 'string' || cursorSecret.length < 32) {
          throw new Error(
            'PRODUCT_QUERY_CURSOR_SECRET 必须配置为至少 32 字符的随机密钥',
          );
        }
        const allowedHashes = String(
          config.TRY_ON_ALLOWED_TEST_IMAGE_SHA256 ?? '',
        )
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (allowedHashes.some((value) => !/^[0-9a-f]{64}$/iu.test(value))) {
          throw new Error(
            'TRY_ON_ALLOWED_TEST_IMAGE_SHA256 必须是逗号分隔的 SHA-256 十六进制摘要',
          );
        }
        parseRateLimitConfig(config);
        return config;
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const rateLimitConfig = parseRateLimitConfig({
          RATE_LIMIT_TTL_MS: configService.get('RATE_LIMIT_TTL_MS'),
          RATE_LIMIT_LIMIT: configService.get('RATE_LIMIT_LIMIT'),
          AUTH_RATE_LIMIT_TTL_MS: configService.get('AUTH_RATE_LIMIT_TTL_MS'),
          AUTH_RATE_LIMIT_LIMIT: configService.get('AUTH_RATE_LIMIT_LIMIT'),
        });
        return {
          throttlers: [
            {
              name: 'default',
              ttl: rateLimitConfig.defaultTtl,
              limit: rateLimitConfig.defaultLimit,
            },
            {
              name: 'auth',
              ttl: rateLimitConfig.authTtl,
              limit: rateLimitConfig.authLimit,
            },
          ],
          errorMessage: '请求过于频繁，请稍后重试',
          setHeaders: true,
        };
      },
    }),
    LoggingModule,
    MikroOrmModule.forRoot(mikroOrmConfig),
    UsersModule,
    UserMemoryModule,
    UserPreferencesModule,
    OrderCatalogCoordinationModule,
    AuthModule,
    LlmModule,
    ChatRecordsModule,
    FashionPersonalizationModule,
    ReturnRefundModule,
    VirtualTryOnModule,
    UserAddressesModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: DbExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
