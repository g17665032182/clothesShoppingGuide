import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorator/public.decorator.js';
import { HealthService } from './health.service.js';

@Controller('health')
@ApiTags('健康检查')
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  public getHealth(): { status: string; service: string; timestamp: string } {
    return this.healthService.getHealth();
  }
}
