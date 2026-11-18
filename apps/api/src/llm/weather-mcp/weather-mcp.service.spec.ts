import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';

import {
  projectWeatherForecast,
  resolveWeatherMcpUrl,
  WeatherMcpService,
} from './weather-mcp.service.js';

const providerResponse =
  "{'results': [{'location': {'name': '上海', 'country': 'CN'}, 'daily': [{'date': '2026-11-18', 'text_day': '多云', 'text_night': '晴', 'high': '14', 'low': '6', 'precip': '0.00', 'wind_direction': '东', 'wind_speed': '8.4', 'wind_scale': '2', 'humidity': '83'}, {'date': '2026-11-19', 'text_day': '阴', 'text_night': '阴', 'high': '12', 'low': '6', 'precip': '0.00', 'wind_direction': '西北', 'wind_speed': '8.4', 'wind_scale': '2', 'humidity': '51'}, {'date': '2026-11-20', 'text_day': '多云', 'text_night': '晴', 'high': '12', 'low': '6', 'precip': '0.00', 'wind_direction': '西北', 'wind_speed': '3.0', 'wind_scale': '1', 'humidity': '54'}, {'date': '2026-11-21', 'text_day': '晴', 'text_night': '晴', 'high': '13', 'low': '7'}]}], 'last_update': '2026-11-18T08:00:00+08:00'}";

test('天气预报安全投影最多保留三天并忽略非白名单字段', () => {
  const result = projectWeatherForecast(providerResponse);
  assert.deepEqual(result, {
    ok: true,
    location: '上海',
    days: [
      {
        date: '2026-11-18',
        dayCondition: '多云',
        nightCondition: '晴',
        highC: 14,
        lowC: 6,
        precipitationMm: 0,
        windDirection: '东',
        windSpeedKmh: null,
        windScale: 2,
        humidityPercent: 83,
      },
      {
        date: '2026-11-19',
        dayCondition: '阴',
        nightCondition: '阴',
        highC: 12,
        lowC: 6,
        precipitationMm: 0,
        windDirection: '西北',
        windSpeedKmh: null,
        windScale: 2,
        humidityPercent: 51,
      },
      {
        date: '2026-11-20',
        dayCondition: '多云',
        nightCondition: '晴',
        highC: 12,
        lowC: 6,
        precipitationMm: 0,
        windDirection: '西北',
        windSpeedKmh: null,
        windScale: 1,
        humidityPercent: 54,
      },
    ],
    updatedAt: '2026-11-18T08:00:00+08:00',
  });
  assert.equal(JSON.stringify(result).includes('wind_speed'), false);
  assert.equal(JSON.stringify(result).includes('country'), false);
});

test('天气预报拒绝错误结构、日期、过长响应和复杂输入', () => {
  for (const value of [
    '{}',
    "{'results': [], 'last_update': 'now'}",
    "{'results': [{'location': {'name': '上海'}, 'daily': [{'date': 'tomorrow'}]}]}",
    "{'results': [{'location': {'name': '上海'}, 'daily': [{'date': '2026-11-18\\nBAD'}]}]}",
    'x'.repeat(40_000),
  ]) {
    assert.throws(() => projectWeatherForecast(value));
  }
  const extraField = projectWeatherForecast(
    "{'results': [{'location': {'name': '上海'}, 'daily': [{'date': '2026-11-18', 'text_day': '晴'}]}], 'extra': !!js/function}",
  );
  assert.equal(JSON.stringify(extraField).includes('js/function'), false);
});

test('天气 MCP endpoint 只接受 HTTPS 固定主机和路径', () => {
  assert.equal(
    resolveWeatherMcpUrl(undefined),
    'https://nihaochen123-cxy.ms.show/gradio_api/mcp/sse',
  );
  assert.equal(
    resolveWeatherMcpUrl('https://nihaochen123-cxy.ms.show/gradio_api/mcp/sse'),
    'https://nihaochen123-cxy.ms.show/gradio_api/mcp/sse',
  );
  for (const url of [
    'http://nihaochen123-cxy.ms.show/gradio_api/mcp/sse',
    'https://evil.example/gradio_api/mcp/sse',
    'https://nihaochen123-cxy.ms.show/other',
    'https://user:pass@nihaochen123-cxy.ms.show/gradio_api/mcp/sse',
    'https://nihaochen123-cxy.ms.show/gradio_api/mcp/sse?token=secret',
  ]) {
    assert.throws(() => resolveWeatherMcpUrl(url));
  }
});

test('天气工具受远程开关及已批准 endpoint 配置控制', async () => {
  const enabled = new WeatherMcpService(
    new ConfigService({
      LLM_ENABLE_REMOTE_TOOLS: 'true',
      WEATHER_MCP_URL: 'https://nihaochen123-cxy.ms.show/gradio_api/mcp/sse',
    }),
  );
  const disabledByFlag = new WeatherMcpService(
    new ConfigService({
      LLM_ENABLE_REMOTE_TOOLS: 'false',
      WEATHER_MCP_URL: 'https://nihaochen123-cxy.ms.show/gradio_api/mcp/sse',
    }),
  );
  const disabledByUrl = new WeatherMcpService(
    new ConfigService({
      LLM_ENABLE_REMOTE_TOOLS: 'true',
      WEATHER_MCP_URL: 'https://unapproved.example/mcp',
    }),
  );

  assert.equal(enabled.isEnabled(), true);
  assert.equal(disabledByFlag.isEnabled(), false);
  assert.equal(disabledByUrl.isEnabled(), false);
  await Promise.all([
    enabled.onModuleDestroy(),
    disabledByFlag.onModuleDestroy(),
    disabledByUrl.onModuleDestroy(),
  ]);
});
