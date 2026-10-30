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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.dev', '.env'],
    }),
    LoggingModule,
    MikroOrmModule.forRoot(mikroOrmConfig),
    UsersModule,
    AuthModule,
    LlmModule,
    ChatRecordsModule,
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
