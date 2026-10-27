import { apiRequest } from '@/api';
import type {
  AdminUpdateUserPayload,
  UpdateProfilePayload,
  User,
} from '@/api/types/users';

export function getCurrentProfile(token: string): Promise<User> {
  return apiRequest<User>('/users/me', { token });
}

export function updateCurrentProfile(
  token: string,
  payload: UpdateProfilePayload,
): Promise<User> {
  return apiRequest<User>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
    token,
  });
}

export function listUsers(token: string): Promise<User[]> {
  return apiRequest<User[]>('/users', { token });
}

export function updateUser(
  token: string,
  userId: string,
  payload: AdminUpdateUserPayload,
): Promise<User> {
  return apiRequest<User>(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    token,
  });
}

export function disableUser(token: string, userId: string): Promise<User> {
  return apiRequest<User>(`/users/${userId}`, {
    method: 'DELETE',
    token,
  });
}
