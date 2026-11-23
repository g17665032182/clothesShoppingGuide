import 'reflect-metadata';
import assert from 'node:assert/strict';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import test from 'node:test';
import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { serializeRequest } from '../../common/logging/logging.module.js';
import { createWeatherClientIpReader } from './weather-client-ip.js';
import { WeatherLocationController } from './weather-location.controller.js';
import { WeatherMcpService } from './weather-mcp.service.js';

test('城市定位忽略不受信连接的转发头并过滤非公网 IPv4', () => {
  const read = createWeatherClientIpReader('10.0.20.0/24');
  const request = (remoteAddress: string, forwarded = '') => {
    const socket = new Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress });
    const message = new IncomingMessage(socket);
    message.headers['x-forwarded-for'] = forwarded;
    return message;
  };
  assert.equal(read(request('::ffff:114.247.50.2', '8.8.8.8')), '114.247.50.2');
  assert.equal(
    read(request('10.0.20.1', '8.8.8.8, 114.247.50.2, 10.0.20.2')),
    '114.247.50.2',
  );
  for (const ip of [
    '127.0.0.1',
    '::1',
    '192.168.1.4',
    '100.64.0.2',
    '203.0.113.7',
    '240.0.0.1',
    '2001:4860::1',
  ]) {
    assert.equal(read(request(ip, '8.8.8.8')), null);
  }
  assert.equal(read(request('10.0.20.1', '8.8.8.8, invalid')), null);
});

test('定位请求日志只包含路由和请求元数据', () => {
  const request = {
    id: 42,
    method: 'POST',
    url: '/api/llm/weather/location/?value=ignored',
    headers: { 'x-forwarded-for': '114.247.50.2' },
    remoteAddress: '127.0.0.1',
  };
  assert.deepEqual(serializeRequest(request), {
    id: 42,
    method: 'POST',
    url: '/api/llm/weather/location/',
  });
  const ordinaryRequest = { ...request, url: '/api/health' };
  assert.equal(serializeRequest(ordinaryRequest), ordinaryRequest);
});

test('定位接口要求登录和按次同意，只向高德传入受信连接解析出的 IP', async () => {
  const calls: string[] = [];
  let enabled = true;
  @Module({
    controllers: [WeatherLocationController],
    providers: [
      {
        provide: ConfigService,
        useValue: new ConfigService({
          WEATHER_LOCATION_TRUSTED_PROXIES: '127.0.0.1',
        }),
      },
      {
        provide: WeatherMcpService,
        useValue: {
          isEnabled: () => enabled,
          locateCity: async (ip: string) => {
            calls.push(ip);
            return '北京市';
          },
        },
      },
    ],
  })
  class WeatherLocationFixture {}

  const app = await NestFactory.create(WeatherLocationFixture, {
    logger: false,
  });
  const jwt = new JwtService({ secret: 'weather-location-http-test-secret' });
  app.useGlobalGuards(
    new JwtAuthGuard(jwt, new Reflector(), {
      findActiveById: async (id: string) => ({ id }),
    } as never),
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  try {
    const url = `${await app.getUrl()}/api/llm/weather/location`;
    const token = await jwt.signAsync({
      sub: '54b8b9fc-9d24-49e8-9d28-b52bff3fa110',
    });
    const request = (
      body: unknown,
      authenticated = true,
      forwarded = '114.247.50.2',
    ) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': forwarded,
          ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await request({ consent: true }, false)).status, 401);
    for (const input of [
      {},
      { consent: false },
      { consent: true, ip: '8.8.8.8' },
    ]) {
      assert.equal((await request(input)).status, 400);
    }
    assert.deepEqual(
      await (await request({ consent: true }, true, '192.168.1.15')).json(),
      { city: null },
    );
    enabled = false;
    assert.deepEqual(await (await request({ consent: true })).json(), {
      city: null,
    });
    assert.deepEqual(calls, []);
    enabled = true;
    const response = await request({ consent: true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { city: '北京市' });
    assert.deepEqual(calls, ['114.247.50.2']);
  } finally {
    await app.close();
  }
});
