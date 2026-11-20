import { tool, type StructuredToolInterface } from '@langchain/core/tools';

import {
  weatherForecastInputSchema,
  weatherForecastResultSchema,
  type WeatherForecastInput,
} from '../dto/weather-forecast.dto.js';
import type { WeatherMcpPort } from '../../llm/weather-mcp/weather-mcp.port.js';

export function createChatWeatherForecastTool(
  weather: Pick<WeatherMcpPort, 'getForecast'>,
  onRequested: () => void,
): StructuredToolInterface {
  let requested = false;
  return tool(
    async (input: WeatherForecastInput) => {
      onRequested();
      if (requested) return JSON.stringify({ ok: false, code: 'unavailable' });
      requested = true;
      try {
        const result = await weather.getForecast(input.city);
        const parsed = weatherForecastResultSchema.safeParse(result);
        return JSON.stringify(
          parsed.success ? parsed.data : { ok: false, code: 'unavailable' },
        );
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'get_weather_forecast',
      description:
        '查询用户明确指定城市的近三天天气预报，作为穿搭参考。结果是预报而非实时实况；城市不明确时先询问。仅依据工具返回的数据描述天气，不推断当前位置。',
      schema: weatherForecastInputSchema,
    },
  );
}
