import { Controller, Get } from '@nestjs/common';

import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  @Get()
  public getHealth(): { status: string; service: string; timestamp: string } {
    return this.healthService.getHealth();
  }
}
