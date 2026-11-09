import { apiRequest } from '@/api';
import type {
  CreateTryOnTaskPayload,
  TryOnDownloadResponse,
  TryOnPhoto,
  TryOnPhotoPage,
  TryOnTask,
  TryOnTaskPage,
  TryOnTaskQuery,
  UploadTryOnPhotoResponse,
} from '@/api/types/try-on';

export function uploadTryOnPhoto(
  token: string,
  file: File,
  save: boolean,
  signal?: AbortSignal,
): Promise<TryOnPhoto> {
  const data = new FormData();
  data.append('file', file);
  data.append('save', String(save));
  return apiRequest<UploadTryOnPhotoResponse | TryOnPhoto>('/try-on/photos', {
    method: 'POST',
    token,
    signal,
    data,
  }).then((response) => {
    // 兼容后端返回“照片摘要”或 { photo: 摘要 } 两种等价投影。
    return 'photo' in response ? response.photo : response;
  });
}

export function listSavedTryOnPhotos(
  token: string,
  signal?: AbortSignal,
): Promise<TryOnPhotoPage> {
  return apiRequest<TryOnPhotoPage>('/try-on/photos', { token, signal });
}

export function deleteTryOnPhoto(
  token: string,
  photoId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(`/try-on/photos/${encodeURIComponent(photoId)}`, {
    method: 'DELETE',
    token,
    signal,
  });
}

export function createTryOnTask(
  token: string,
  payload: CreateTryOnTaskPayload,
  signal?: AbortSignal,
): Promise<TryOnTask> {
  return apiRequest<TryOnTask>('/try-on/tasks', {
    method: 'POST',
    token,
    signal,
    data: payload,
  });
}

export function listTryOnTasks(
  token: string,
  query: TryOnTaskQuery = {},
  signal?: AbortSignal,
): Promise<TryOnTaskPage> {
  return apiRequest<TryOnTaskPage>('/try-on/tasks', {
    token,
    signal,
    params: query,
  });
}

export function getTryOnTask(
  token: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<TryOnTask> {
  return apiRequest<TryOnTask>(`/try-on/tasks/${encodeURIComponent(taskId)}`, {
    token,
    signal,
  });
}

export function getTryOnResultDownload(
  token: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<TryOnDownloadResponse> {
  return apiRequest<TryOnDownloadResponse>(
    `/try-on/tasks/${encodeURIComponent(taskId)}/result`,
    { token, signal },
  );
}

export function deleteTryOnTask(
  token: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(`/try-on/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    token,
    signal,
  });
}

export function markTryOnNotificationRead(
  token: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(
    `/try-on/tasks/${encodeURIComponent(taskId)}/notification-read`,
    { method: 'POST', token, signal, data: {} },
  );
}
