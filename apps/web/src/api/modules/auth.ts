import { apiRequest } from '@/api';
import type { AuthResponse } from '@/api/types/auth';
import type { User } from '@/api/types/users';

export function signIn(email: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function register(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

export function refreshAccessToken(): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/refresh', {
    method: 'POST',
    allowRefresh: false,
  });
}

export function getCurrentUser(token: string): Promise<User> {
  return apiRequest<User>('/auth/me', { token });
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', {
    method: 'POST',
    allowRefresh: false,
  });
}
