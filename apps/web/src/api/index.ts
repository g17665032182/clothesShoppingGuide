import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(
  /\/+$/,
  '',
);

export class ApiError extends Error {
  /** status 为 0 时表示网络错误或请求未收到 HTTP 响应。 */
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Axios 请求配置的项目统一扩展。 */
export interface ApiRequestOptions extends AxiosRequestConfig {
  /** 当前请求使用的访问令牌。 */
  token?: string;
  /** 是否允许当前请求触发 Refresh Token 刷新。 */
  allowRefresh?: boolean;
}

type AuthTransport = {
  refresh: () => Promise<string | null>;
  onUnauthorized: () => void;
  onAdminForbidden?: () => Promise<void>;
};

type ApiAxiosRequestConfig = ApiRequestOptions & {
  /** 标记请求已经完成一次刷新重试，防止无限循环。 */
  _refreshRetried?: boolean;
};

let authTransport: AuthTransport | null = null;
let refreshing: Promise<string | null> | null = null;
let refreshingAdminRole: Promise<void> | null = null;

// 通过回调解耦请求层与认证状态，避免 API 层直接依赖 Vue 响应式状态。
export function configureAuthTransport(transport: AuthTransport): void {
  authTransport = transport;
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

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<unknown>;
    return new ApiError(
      resolveErrorMessage(axiosError.response?.data),
      axiosError.response?.status ?? 0,
    );
  }

  return new ApiError('请求失败，请稍后重试', 0);
}

function isFormData(value: unknown): boolean {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

function isRefreshRequest(url?: string): boolean {
  return url === '/auth/refresh' || url?.endsWith('/auth/refresh') === true;
}

function setAuthorizationHeader(
  config: InternalAxiosRequestConfig,
  token: string,
): void {
  config.headers.set('Authorization', `Bearer ${token}`);
}

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: apiBaseUrl,
    withCredentials: true,
  });

  client.interceptors.request.use((config) => {
    const requestConfig = config as InternalAxiosRequestConfig &
      ApiAxiosRequestConfig;

    if (requestConfig.token) {
      setAuthorizationHeader(requestConfig, requestConfig.token);
    }

    if (
      requestConfig.data &&
      !isFormData(requestConfig.data) &&
      !requestConfig.headers.has('Content-Type')
    ) {
      requestConfig.headers.set('Content-Type', 'application/json');
    }

    return requestConfig;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!axios.isAxiosError(error)) {
        throw toApiError(error);
      }

      const axiosError = error as AxiosError<unknown>;
      const originalConfig = axiosError.config as
        ApiAxiosRequestConfig | undefined;
      const shouldRefresh =
        axiosError.response?.status === 401 &&
        originalConfig?.allowRefresh !== false &&
        Boolean(originalConfig?.token) &&
        Boolean(authTransport) &&
        !originalConfig?._refreshRetried &&
        !isRefreshRequest(originalConfig?.url);

      if (shouldRefresh && authTransport && originalConfig) {
        originalConfig._refreshRetried = true;
        refreshing ??= authTransport.refresh().finally(() => {
          refreshing = null;
        });

        let refreshedToken: string | null = null;
        try {
          refreshedToken = await refreshing;
        } catch {
          refreshedToken = null;
        }

        if (refreshedToken) {
          originalConfig.token = refreshedToken;
          return client.request(originalConfig);
        }

        authTransport.onUnauthorized();
      }

      // 管理权限可能已被后台收回；统一同步角色，交由全局路由处理退出管理页。
      if (
        axiosError.response?.status === 403 &&
        originalConfig?.url?.startsWith('/admin/') &&
        authTransport?.onAdminForbidden
      ) {
        refreshingAdminRole ??= authTransport
          .onAdminForbidden()
          .catch(() => undefined)
          .finally(() => {
            refreshingAdminRole = null;
          });
        await refreshingAdminRole;
      }

      throw toApiError(error);
    },
  );

  return client;
}

const apiClient = createApiClient();

/**
 * 统一处理 API 请求和响应。
 *
 * T 表示接口成功响应的数据类型，例如 apiRequest<User>()。
 * 业务模块应优先封装具体接口，不要在页面中直接调用该底层方法。
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const requestConfig: ApiAxiosRequestConfig = {
    ...options,
    url: path,
  };

  try {
    const response = await apiClient.request<T>(requestConfig);
    if (response.status === 204) return undefined as T;
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * 使用统一 Axios 客户端读取 Fetch adapter 提供的浏览器流。
 * Token 保持显式传入，确保流式请求也经过现有 Refresh Token 拦截器。
 */
export async function apiStreamRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
}> {
  const requestConfig: ApiAxiosRequestConfig = {
    ...options,
    adapter: 'fetch',
    responseType: 'stream',
    url: path,
  };

  try {
    const response =
      await apiClient.request<ReadableStream<Uint8Array>>(requestConfig);
    if (!response.data || typeof response.data.getReader !== 'function') {
      throw new ApiError('服务器未返回可读取的聊天数据流', response.status);
    }
    return {
      stream: response.data,
      contentType: String(response.headers['content-type'] ?? ''),
    };
  } catch (error) {
    throw toApiError(error);
  }
}
