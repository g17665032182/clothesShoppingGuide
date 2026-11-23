import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { createWeatherClientIpReader } from './weather-client-ip.js';
import { WeatherMcpService } from './weather-mcp.service.js';

export const weatherLocationConsentSchema = z.strictObject({
  consent: z.literal(true),
});

@Controller('llm/weather')
@ApiBearerAuth('bearer')
@ApiTags('大模型聊天')
export class WeatherLocationController {
  private readonly readClientIp: ReturnType<typeof createWeatherClientIpReader>;

  public constructor(
    private readonly weather: WeatherMcpService,
    config: ConfigService,
  ) {
    try {
      this.readClientIp = createWeatherClientIpReader(
        config.get<string>('WEATHER_LOCATION_TRUSTED_PROXIES') ?? '',
      );
    } catch {
      throw new Error(
        'WEATHER_LOCATION_TRUSTED_PROXIES 必须是逗号分隔的受信代理地址或 CIDR',
      );
    }
  }

  @Post('location')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['consent'],
      properties: { consent: { type: 'boolean', enum: [true] } },
      additionalProperties: false,
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['city'],
      properties: { city: { type: 'string', nullable: true } },
    },
  })
  public async locateCity(
    @Body({ schema: weatherLocationConsentSchema }) _consent: z.infer<
      typeof weatherLocationConsentSchema
    >,
    @Req() request: IncomingMessage,
  ): Promise<{ city: string | null }> {
    const ip = this.weather.isEnabled() ? this.readClientIp(request) : null;
    return { city: ip ? await this.weather.locateCity(ip) : null };
  }
}
