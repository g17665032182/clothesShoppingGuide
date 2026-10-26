import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/public.decorator.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  public getHealth(): { status: string; service: string; timestamp: string } {
    return this.healthService.getHealth();
  }
}
