import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatWeatherForecastTool } from '../tools/chat-weather-forecast.tool.js';

const forecast = {
  ok: true as const,
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
  ],
  updatedAt: '2026-11-18T08:00:00+08:00',
};

test('天气工具严格验证城市、每轮至多调用一次并返回安全结果', async () => {
  let calls = 0;
  let marks = 0;
  const query = createChatWeatherForecastTool(
    {
      getForecast: async (city) => {
        calls += 1;
        assert.equal(city, '上海');
        return forecast;
      },
    },
    () => {
      marks += 1;
    },
  );

  assert.deepEqual(
    JSON.parse(await query.invoke({ city: ' 上海 ' })),
    forecast,
  );
  assert.deepEqual(JSON.parse(await query.invoke({ city: '上海' })), {
    ok: false,
    code: 'unavailable',
  });
  assert.equal(calls, 1);
  assert.equal(marks, 2);

  for (const input of [
    { city: '' },
    { city: '  ' },
    { city: 'https://example.com' },
    { city: '31.2,121.5' },
    { city: '上海', userId: 'other-user' },
    { city: 'a'.repeat(101) },
  ]) {
    await assert.rejects(() => query.invoke(input as never));
  }
});

test('天气工具将连接失败和不符合契约的结果统一降级', async () => {
  const results = [
    { ok: false, code: 'private-error', apiKey: 'secret' },
    { ok: true, location: '上海', days: [], updatedAt: null },
  ];
  const query = createChatWeatherForecastTool(
    {
      getForecast: async () => {
        const result = results.shift();
        if (!result) throw new Error('private-connection-error');
        return result as never;
      },
    },
    () => undefined,
  );
  for (let index = 0; index < 2; index += 1) {
    assert.deepEqual(JSON.parse(await query.invoke({ city: '上海' })), {
      ok: false,
      code: 'unavailable',
    });
  }
  await assert.doesNotReject(() =>
    query.invoke({ city: '上海' }).then((value) => {
      assert.equal(String(value).includes('secret'), false);
    }),
  );
});
