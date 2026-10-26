import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  public getHealth(): {
    status: string;
    service: string;
    timestamp: string;
  } {
    return {
      status: 'ok',
      service: 'clothes-shopping-guide-api',
      timestamp: new Date().toISOString(),
    };
  }
}
