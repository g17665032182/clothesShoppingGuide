export const WEATHER_MCP_PORT = Symbol('WEATHER_MCP_PORT');

export type WeatherForecastDay = {
  date: string;
  dayCondition: string | null;
  nightCondition: string | null;
  highC: number | null;
  lowC: number | null;
  precipitationMm: number | null;
  windDirection: string | null;
  windSpeedKmh: number | null;
  windScale: number | null;
  humidityPercent: number | null;
};

export type WeatherForecastResult = {
  ok: true;
  location: string;
  days: WeatherForecastDay[];
  updatedAt: string | null;
};

export type WeatherForecastFailure = {
  ok: false;
  code: 'unavailable';
};

export type WeatherForecastResponse =
  | WeatherForecastResult
  | WeatherForecastFailure;

export interface WeatherMcpPort {
  isEnabled(): boolean;
  getForecast(city: string): Promise<WeatherForecastResponse>;
}
