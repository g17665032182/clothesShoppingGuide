import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';

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
        return config;
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
    VirtualTryOnModule,
    UserAddressesModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: DbExceptionFilter,
    },
  ],
})
export class AppModule {}
