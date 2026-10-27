import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import mikroOrmConfig from './mikro-orm.config.js';
import { AuthModule } from './auth/auth.module.js';
import { ChatRecordsModule } from './chat-records/chat-records.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { LlmModule } from './llm/llm.module.js';
import { LoggingModule } from './logging/logging.module.js';
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
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
