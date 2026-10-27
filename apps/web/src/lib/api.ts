export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type AuthTransport = {
  refresh: () => Promise<string | null>;
  onUnauthorized: () => void;
};

let authTransport: AuthTransport | null = null;
let refreshing: Promise<string | null> | null = null;

// 通过回调解耦请求层与认证状态，避免 API 模块直接依赖 Vue 状态。
export function configureAuthTransport(transport: AuthTransport): void {
  authTransport = transport;
}

// 统一处理 API 前缀、JWT 请求头和 NestJS 错误响应。
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
  allowRefresh = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  if (
    response.status === 401 &&
    allowRefresh &&
    token &&
    authTransport &&
    path !== '/auth/refresh'
  ) {
    refreshing ??= authTransport.refresh().finally(() => {
      refreshing = null;
    });
    const refreshedToken = await refreshing;
    if (refreshedToken) {
      return apiRequest<T>(path, options, refreshedToken, false);
    }
    authTransport.onUnauthorized();
  }
  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = payload as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join('；')
      : body?.message;
    throw new ApiError(message ?? '请求失败，请稍后重试', response.status);
  }
  return payload as T;
}
