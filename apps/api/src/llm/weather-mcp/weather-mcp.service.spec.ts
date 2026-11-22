import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';

import {
  projectWeatherForecast,
  WeatherMcpService,
} from './weather-mcp.service.js';

const providerResponse =
  '{"city":"上海市","forecasts":[{"date":"2026-11-18","dayweather":"多云","nightweather":"晴","daytemp":"14","nighttemp":"6","daywind":"东","daypower":"2"},{"date":"2026-11-19","dayweather":"阴","nightweather":"阴","daytemp":"12","nighttemp":"6","daywind":"西北","daypower":"2"},{"date":"2026-11-20","dayweather":"多云","nightweather":"晴","daytemp":"12","nighttemp":"6","daywind":"西北","daypower":"1"},{"date":"2026-11-21","dayweather":"晴","nightweather":"晴","daytemp":"13","nighttemp":"7"}]}';

test('天气预报安全投影最多保留三天并忽略非白名单字段', () => {
  const result = projectWeatherForecast(providerResponse);
  assert.deepEqual(result, {
    ok: true,
    location: '上海市',
    days: [
      {
        date: '2026-11-18',
        dayCondition: '多云',
        nightCondition: '晴',
        highC: 14,
        lowC: 6,
        precipitationMm: null,
        windDirection: '东',
        windSpeedKmh: null,
        windScale: 2,
        humidityPercent: null,
      },
      {
        date: '2026-11-19',
        dayCondition: '阴',
        nightCondition: '阴',
        highC: 12,
        lowC: 6,
        precipitationMm: null,
        windDirection: '西北',
        windSpeedKmh: null,
        windScale: 2,
        humidityPercent: null,
      },
      {
        date: '2026-11-20',
        dayCondition: '多云',
        nightCondition: '晴',
        highC: 12,
        lowC: 6,
        precipitationMm: null,
        windDirection: '西北',
        windSpeedKmh: null,
        windScale: 1,
        humidityPercent: null,
      },
    ],
    updatedAt: null,
  });
  assert.equal(JSON.stringify(result).includes('reporttime'), false);
  assert.equal(JSON.stringify(result).includes('city'), false);
});

test('天气预报拒绝错误结构、日期、过长响应和复杂输入', () => {
  for (const value of [
    '{}',
    '{"status":"0","forecasts":[]}',
    '{"city":"上海","forecasts":[{"date":"tomorrow"}]}',
    '{"city":"上海","forecasts":[{"date":"2026-11-18\\nBAD"}]}',
    'x'.repeat(40_000),
  ]) {
    assert.throws(() => projectWeatherForecast(value));
  }
  const extraField = projectWeatherForecast(
    '{"city":"上海","forecasts":[{"date":"2026-11-18","dayweather":"晴"}],"extra":"untrusted"}',
  );
  assert.equal(JSON.stringify(extraField).includes('untrusted'), false);
});

test('天气工具仅在远程工具开关开启且配置高德 API Key 时注册', async () => {
  const enabled = new WeatherMcpService(
    new ConfigService({
      LLM_ENABLE_REMOTE_TOOLS: 'true',
      AMAP_MAPS_API_KEY: 'test-key',
    }),
  );
  const disabledByFlag = new WeatherMcpService(
    new ConfigService({
      LLM_ENABLE_REMOTE_TOOLS: 'false',
      AMAP_MAPS_API_KEY: 'test-key',
    }),
  );
  const disabledByKey = new WeatherMcpService(
    new ConfigService({
      LLM_ENABLE_REMOTE_TOOLS: 'true',
    }),
  );

  assert.equal(enabled.isEnabled(), true);
  assert.equal(disabledByFlag.isEnabled(), false);
  assert.equal(disabledByKey.isEnabled(), false);
  await Promise.all([
    enabled.onModuleDestroy(),
    disabledByFlag.onModuleDestroy(),
    disabledByKey.onModuleDestroy(),
  ]);
});
