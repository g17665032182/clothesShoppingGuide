import { apiRequest } from '@/api';
import type {
  CreateMemoryPayload,
  DeleteAllMemoriesResponse,
  MemoryListResponse,
  MemorySettings,
  MemoryRecord,
  UpdateMemoryPayload,
} from '@/api/types/memories';

export function listMemories(
  token: string,
  options: {
    page?: number;
    pageSize?: number;
    category?: string;
    signal?: AbortSignal;
  } = {},
): Promise<MemoryListResponse> {
  const query = new URLSearchParams({
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 20),
  });
  if (options.category) query.set('category', options.category);

  return apiRequest<MemoryListResponse>(`/memories?${query.toString()}`, {
    token,
    signal: options.signal,
  });
}

export function createMemory(
  token: string,
  payload: CreateMemoryPayload,
): Promise<MemoryRecord> {
  return apiRequest<MemoryRecord>('/memories', {
    method: 'POST',
    data: payload,
    token,
  });
}

export function updateMemory(
  token: string,
  memoryId: string,
  payload: UpdateMemoryPayload,
): Promise<MemoryRecord> {
  return apiRequest<MemoryRecord>(`/memories/${memoryId}`, {
    method: 'PATCH',
    data: payload,
    token,
  });
}

export function deleteMemory(token: string, memoryId: string): Promise<void> {
  return apiRequest<void>(`/memories/${memoryId}`, {
    method: 'DELETE',
    token,
  });
}

export function deleteAllMemories(
  token: string,
): Promise<DeleteAllMemoriesResponse> {
  return apiRequest<DeleteAllMemoriesResponse>('/memories', {
    method: 'DELETE',
    data: { confirm: true },
    token,
  });
}

export function updateMemorySettings(
  token: string,
  enabled: boolean,
): Promise<MemorySettings> {
  return apiRequest<MemorySettings>('/memories/settings', {
    method: 'PATCH',
    data: { enabled },
    token,
  });
}
