const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(
  /\/+$/,
  '',
);

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestOptions extends RequestInit {
  /** 当前请求使用的访问令牌。 */
  token?: string;
  /** 是否允许当前请求触发 Refresh Token 刷新。 */
  allowRefresh?: boolean;
}

type AuthTransport = {
  refresh: () => Promise<string | null>;
  onUnauthorized: () => void;
};

let authTransport: AuthTransport | null = null;
let refreshing: Promise<string | null> | null = null;

// 通过回调解耦请求层与认证状态，避免 API 层直接依赖 Vue 响应式状态。
export function configureAuthTransport(transport: AuthTransport): void {
  authTransport = transport;
}

function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${apiBaseUrl}/${path.replace(/^\/+/, '')}`;
}

function resolveErrorMessage(payload: unknown): string {
  if (typeof payload === 'string' && payload.trim()) return payload;

  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (Array.isArray(message)) {
      return message
        .filter((item): item is string => typeof item === 'string')
        .join('；');
    }
    if (typeof message === 'string' && message.trim()) return message;
  }

  return '请求失败，请稍后重试';
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

// 统一处理 API 前缀、请求头、NestJS 错误响应和过期访问令牌重试。
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    allowRefresh = true,
    headers: requestHeaders,
    token,
    ...requestInit
  } = options;
  const headers = new Headers(requestHeaders);

  if (requestInit.body && !(requestInit.body instanceof FormData)) {
    headers.set(
      'Content-Type',
      headers.get('Content-Type') ?? 'application/json',
    );
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(resolveApiUrl(path), {
    ...requestInit,
    credentials: 'include',
    headers,
  });

  const shouldRefresh =
    response.status === 401 &&
    allowRefresh &&
    Boolean(token) &&
    Boolean(authTransport) &&
    path !== '/auth/refresh';

  if (shouldRefresh && authTransport) {
    refreshing ??= authTransport.refresh().finally(() => {
      refreshing = null;
    });
    const refreshedToken = await refreshing;
    if (refreshedToken) {
      return apiRequest<T>(path, {
        ...requestInit,
        headers: requestHeaders,
        token: refreshedToken,
        allowRefresh: false,
      });
    }
    authTransport.onUnauthorized();
  }

  if (response.status === 204) return undefined as T;

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new ApiError(resolveErrorMessage(payload), response.status);
  }

  return payload as T;
}
