import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MCPAdapter } from '@langchain/mcp-adapters';
import { parseDocument } from 'yaml';

import type {
  WeatherForecastDay,
  WeatherForecastResponse,
  WeatherForecastResult,
  WeatherMcpPort,
} from './weather-mcp.port.js';

const WEATHER_TOOL_NAME = 'maps_weather';
const AMAP_MCP_PACKAGE = '@amap/amap-maps-mcp-server@0.0.8';
const WEATHER_TOOL_TIMEOUT_MS = 10_000;
const WEATHER_DISCOVERY_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 32_768;
const MAX_PARSE_DEPTH = 12;
const MAX_PARSE_NODES = 2_000;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberWithin(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function safeTimestamp(value: unknown): string | null {
  const timestamp = boundedText(value, 40);
  if (
    !timestamp ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      timestamp,
    ) ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    return null;
  }
  return timestamp;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('weather_discovery_timeout')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseWeatherMcpResponse(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES)
    throw new Error('response_limit');

  const document = parseDocument(text, {
    schema: 'failsafe',
    strict: true,
    uniqueKeys: true,
    merge: false,
    prettyErrors: false,
  });
  if (document.errors.length > 0 || !document.contents)
    throw new Error('response_parse');

  const value: unknown = document.toJS({ maxAliasCount: 0 });
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_PARSE_NODES || current.depth > MAX_PARSE_DEPTH)
      throw new Error('response_complexity');
    if (Array.isArray(current.value)) {
      for (const child of current.value)
        pending.push({ value: child, depth: current.depth + 1 });
    } else {
      const record = asRecord(current.value);
      if (record) {
        for (const child of Object.values(record))
          pending.push({ value: child, depth: current.depth + 1 });
      } else if (current.value !== null && typeof current.value !== 'string') {
        throw new Error('response_type');
      }
    }
  }
  return value;
}

function safeCondition(value: unknown): string | null {
  const text = boundedText(value, 32);
  if (!text || /[\r\n]/u.test(text)) return null;
  return text;
}

function safeAmapDay(value: unknown): WeatherForecastDay | null {
  const day = asRecord(value);
  if (!day) return null;
  const date = boundedText(day.date, 10);
  if (!date || !isCalendarDate(date)) return null;

  return {
    date,
    dayCondition: safeCondition(day.dayweather ?? day.dayWeather),
    nightCondition: safeCondition(day.nightweather ?? day.nightWeather),
    highC: numberWithin(day.daytemp ?? day.dayTemp, -100, 70),
    lowC: numberWithin(day.nighttemp ?? day.nightTemp, -100, 70),
    precipitationMm: null,
    windDirection: boundedText(day.daywind ?? day.dayWindDir, 16),
    windSpeedKmh: null,
    windScale: numberWithin(day.daypower ?? day.dayWindPower, 0, 17),
    humidityPercent: null,
  };
}

export function projectWeatherForecast(text: string): WeatherForecastResult {
  const response = asRecord(parseWeatherMcpResponse(text));
  if (!response || response.status === '0' || response.status === 0)
    throw new Error('response_shape');
  const forecast = asRecord(response.forecast);
  const upstreamForecasts = Array.isArray(response.forecasts)
    ? response.forecasts
    : null;
  const firstForecast = upstreamForecasts
    ? asRecord(upstreamForecasts[0])
    : null;
  const packageDays =
    boundedText(response.city, 100) && firstForecast?.date
      ? upstreamForecasts
      : null;
  const city = boundedText(
    response.city ?? firstForecast?.city ?? forecast?.city,
    100,
  );
  const daily =
    packageDays ??
    firstForecast?.casts ??
    forecast?.casts ??
    forecast?.forecasts ??
    response.casts;
  if (!city || !Array.isArray(daily) || daily.length === 0)
    throw new Error('response_shape');
  const days = daily.slice(0, 3).map(safeAmapDay);
  if (days.some((day) => day === null)) throw new Error('response_shape');

  return {
    ok: true,
    location: city,
    days: days as WeatherForecastDay[],
    updatedAt: safeTimestamp(forecast?.reporttime ?? response.reporttime),
  };
}

@Injectable()
export class WeatherMcpService implements WeatherMcpPort, OnModuleDestroy {
  private readonly logger = new Logger(WeatherMcpService.name);
  private adapter: MCPAdapter | undefined;
  private toolsPromise: ReturnType<MCPAdapter['listTools']> | undefined;

  public constructor(private readonly config: ConfigService) {}

  public isEnabled(): boolean {
    return (
      this.config.get<string>('LLM_ENABLE_REMOTE_TOOLS') === 'true' &&
      Boolean(this.config.get<string>('AMAP_MAPS_API_KEY')?.trim())
    );
  }

  public async getForecast(city: string): Promise<WeatherForecastResponse> {
    try {
      const tools = await this.getWeatherTools();
      const weatherTool = tools.find(
        (candidate) => candidate.name === WEATHER_TOOL_NAME,
      );
      if (!weatherTool) return this.unavailable('tool_missing');
      const output = await weatherTool.invoke(
        { city },
        { signal: AbortSignal.timeout(WEATHER_TOOL_TIMEOUT_MS) },
      );
      if (typeof output !== 'string') return this.unavailable('output_type');
      return projectWeatherForecast(output);
    } catch {
      return this.unavailable('request_failed');
    }
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.adapter) await this.adapter.close();
    this.adapter = undefined;
    this.toolsPromise = undefined;
  }

  private async getWeatherTools() {
    if (!this.toolsPromise) {
      this.adapter ??= new MCPAdapter({
        prefixToolNameWithServerName: false,
        servers: {
          weather: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', AMAP_MCP_PACKAGE],
            // 仅传递高德 Key，并丢弃第三方进程输出，避免凭据进入应用日志。
            env: {
              PATH: process.env.PATH ?? '',
              ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
              ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
              AMAP_MAPS_API_KEY: this.config
                .get<string>('AMAP_MAPS_API_KEY')!
                .trim(),
            },
            stderr: 'ignore',
            defaultToolTimeout: WEATHER_TOOL_TIMEOUT_MS,
          },
        },
        onConnectionError: 'throw',
        throwOnLoadError: true,
      });
      const adapter = this.adapter;
      this.toolsPromise = withTimeout(
        adapter.listTools('weather'),
        WEATHER_DISCOVERY_TIMEOUT_MS,
      ).catch(async (error) => {
        this.toolsPromise = undefined;
        await adapter.close();
        if (this.adapter === adapter) this.adapter = undefined;
        throw error;
      });
    }
    return this.toolsPromise;
  }

  private unavailable(reason: string): WeatherForecastResponse {
    this.logger.warn(`天气 MCP 查询不可用：${reason}`);
    return { ok: false, code: 'unavailable' };
  }
}
