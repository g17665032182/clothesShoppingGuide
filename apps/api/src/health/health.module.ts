import { Module } from '@nestjs/common';

import { HealthController } from './controller/health.controller.js';
import { HealthService } from './service/health.service.js';

// 健康检查独立成模块，避免将 HTTP 入口和业务服务注册散落在根模块中。
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
