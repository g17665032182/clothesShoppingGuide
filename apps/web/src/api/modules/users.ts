import { apiRequest } from '@/api';
import type {
  AdminUpdateUserPayload,
  UpdateProfilePayload,
  User,
} from '@/api/types/users';

/** 获取当前登录用户资料。 */
export function getCurrentProfile(token: string): Promise<User> {
  return apiRequest<User>('/users/me', { token });
}

/** 更新当前登录用户资料。 */
export function updateCurrentProfile(
  token: string,
  payload: UpdateProfilePayload,
): Promise<User> {
  return apiRequest<User>('/users/me', {
    method: 'PATCH',
    data: payload,
    token,
  });
}

/** 管理员获取用户列表。 */
export function listUsers(token: string): Promise<User[]> {
  return apiRequest<User[]>('/users', { token });
}

/** 管理员更新用户资料、角色或状态。 */
export function updateUser(
  token: string,
  userId: string,
  payload: AdminUpdateUserPayload,
): Promise<User> {
  return apiRequest<User>(`/users/${userId}`, {
    method: 'PATCH',
    data: payload,
    token,
  });
}

/** 管理员逻辑禁用用户。 */
export function disableUser(token: string, userId: string): Promise<User> {
  return apiRequest<User>(`/users/${userId}`, {
    method: 'DELETE',
    token,
  });
}
