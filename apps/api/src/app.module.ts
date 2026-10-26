import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import mikroOrmConfig from './mikro-orm.config.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    MikroOrmModule.forRoot(mikroOrmConfig),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
