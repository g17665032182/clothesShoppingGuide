import { apiRequest } from '@/api';
import type {
  CreatePreferencePayload,
  DeleteAllPreferencesResponse,
  PreferenceCategory,
  PreferenceListResponse,
  PreferenceRecord,
  PreferenceSettings,
  UpdatePreferencePayload,
} from '@/api/types/preferences';

export function listPreferences(
  token: string,
  options: {
    page?: number;
    pageSize?: number;
    category?: PreferenceCategory;
    signal?: AbortSignal;
  } = {},
): Promise<PreferenceListResponse> {
  return apiRequest<PreferenceListResponse>('/preferences', {
    token,
    signal: options.signal,
    params: {
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 20,
      ...(options.category ? { category: options.category } : {}),
    },
  });
}

export function createPreference(
  token: string,
  payload: CreatePreferencePayload,
  signal?: AbortSignal,
): Promise<PreferenceRecord> {
  return apiRequest<PreferenceRecord>('/preferences', {
    method: 'POST',
    data: payload,
    token,
    signal,
  });
}

export function updatePreference(
  token: string,
  preferenceId: string,
  payload: UpdatePreferencePayload,
  signal?: AbortSignal,
): Promise<PreferenceRecord> {
  return apiRequest<PreferenceRecord>(`/preferences/${preferenceId}`, {
    method: 'PATCH',
    data: payload,
    token,
    signal,
  });
}

export function deletePreference(
  token: string,
  preferenceId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(`/preferences/${preferenceId}`, {
    method: 'DELETE',
    token,
    signal,
  });
}

export function deleteAllPreferences(
  token: string,
  signal?: AbortSignal,
): Promise<DeleteAllPreferencesResponse> {
  return apiRequest<DeleteAllPreferencesResponse>('/preferences', {
    method: 'DELETE',
    data: { confirm: true },
    token,
    signal,
  });
}

export function getPreferenceSettings(
  token: string,
  signal?: AbortSignal,
): Promise<PreferenceSettings> {
  return apiRequest<PreferenceSettings>('/preferences/settings', {
    token,
    signal,
  });
}

export function updatePreferenceSettings(
  token: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<PreferenceSettings> {
  return apiRequest<PreferenceSettings>('/preferences/settings', {
    method: 'PATCH',
    data: { enabled },
    token,
    signal,
  });
}
