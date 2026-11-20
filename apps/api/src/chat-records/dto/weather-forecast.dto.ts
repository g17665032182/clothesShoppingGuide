import { z } from 'zod';

export const weatherForecastInputSchema = z.strictObject({
  city: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(
      (value) =>
        !/^[a-z][a-z\d+.-]*:\/\//iu.test(value) &&
        !/^-?\d+(?:\.\d+)?\s*[,;]\s*-?\d+(?:\.\d+)?$/u.test(value),
      '城市名称不能是 URL 或坐标',
    ),
});

const weatherForecastDaySchema = z.strictObject({
  date: z.string(),
  dayCondition: z.string().nullable(),
  nightCondition: z.string().nullable(),
  highC: z.number().nullable(),
  lowC: z.number().nullable(),
  precipitationMm: z.number().nullable(),
  windDirection: z.string().nullable(),
  windSpeedKmh: z.number().nullable(),
  windScale: z.number().nullable(),
  humidityPercent: z.number().nullable(),
});

export const weatherForecastResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    location: z.string(),
    days: z.array(weatherForecastDaySchema).min(1).max(3),
    updatedAt: z.string().nullable(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.literal('unavailable'),
  }),
]);

export type WeatherForecastInput = z.infer<typeof weatherForecastInputSchema>;
