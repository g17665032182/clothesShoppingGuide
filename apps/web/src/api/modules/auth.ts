import { apiRequest } from '@/api';
import type {
  AuthResponse,
  LoginPayload,
  RegisterPayload,
} from '@/api/types/auth';
import type { User } from '@/api/types/users';

/** 用户登录，成功后服务端会通过 HttpOnly Cookie 写入 Refresh Token。 */
export function signIn(payload: LoginPayload): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    data: payload,
  });
}

/** 用户注册，成功后返回访问令牌和当前用户资料。 */
export function register(payload: RegisterPayload): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    data: payload,
  });
}

/** 使用 HttpOnly Refresh Token Cookie 换取新的访问令牌。 */
export function refreshAccessToken(): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/refresh', {
    method: 'POST',
    allowRefresh: false,
  });
}

/** 获取当前登录用户，需要 Bearer JWT。 */
export function getCurrentUser(token: string): Promise<User> {
  return apiRequest<User>('/auth/me', { token });
}

/** 撤销当前 Refresh Token，会话失效后接口返回 204。 */
export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', {
    method: 'POST',
    allowRefresh: false,
  });
}
