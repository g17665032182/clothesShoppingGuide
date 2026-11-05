import { apiRequest } from '@/api';
import type { MemoryDocument, MemorySettings } from '@/api/types/memories';

export function getMemorySettings(
  token: string,
  signal?: AbortSignal,
): Promise<MemorySettings> {
  return apiRequest<MemorySettings>('/memories/settings', { token, signal });
}

export function updateMemorySettings(
  token: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<MemorySettings> {
  return apiRequest<MemorySettings>('/memories/settings', {
    method: 'PATCH',
    data: { enabled },
    token,
    signal,
  });
}

export function getMemoryDocument(
  token: string,
  signal?: AbortSignal,
): Promise<MemoryDocument> {
  return apiRequest<MemoryDocument>('/memories/document', { token, signal });
}

export function updateMemoryDocument(
  token: string,
  content: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<MemoryDocument> {
  return apiRequest<MemoryDocument>('/memories/document', {
    method: 'PUT',
    data: { content, expectedRevision },
    token,
    signal,
  });
}

export function clearMemoryDocument(
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>('/memories/document', {
    method: 'DELETE',
    token,
    signal,
  });
}

export function flushMemoryTasks(
  token: string,
  conversationId: string,
  keepalive = false,
): Promise<void> {
  return apiRequest<void>('/memories/tasks/flush', {
    method: 'POST',
    data: { conversationId },
    token,
    ...(keepalive
      ? {
          adapter: 'fetch',
          fetchOptions: { keepalive: true },
          allowRefresh: false,
        }
      : {}),
  });
}
