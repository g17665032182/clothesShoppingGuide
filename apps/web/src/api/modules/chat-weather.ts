import { apiRequest } from '@/api';
import type { ChatWeatherLocation } from '@/api/types/chat-weather';

export function locateWeatherCity(
  token: string,
  signal: AbortSignal,
): Promise<ChatWeatherLocation> {
  return apiRequest<ChatWeatherLocation>('/llm/weather/location', {
    method: 'POST',
    token,
    signal,
    data: { consent: true },
  });
}
