import { apiRequest } from '@/api';
import type {
  CreateUserAddressPayload,
  UpdateUserAddressPayload,
  UserAddress,
  UserAddressPage,
  UserAddressQuery,
} from '@/api/types/user-addresses';

function toQuery(query: UserAddressQuery): string {
  return new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  }).toString();
}

/** 获取当前用户自己的收货地址分页列表。 */
export function listUserAddresses(
  token: string,
  query: UserAddressQuery,
  signal?: AbortSignal,
): Promise<UserAddressPage> {
  return apiRequest<UserAddressPage>(`/users/me/addresses?${toQuery(query)}`, {
    token,
    signal,
  });
}

/** 创建本人地址；相同 requestKey 与内容的重试由服务端幂等处理。 */
export function createUserAddress(
  token: string,
  payload: CreateUserAddressPayload,
  signal?: AbortSignal,
): Promise<UserAddress> {
  return apiRequest<UserAddress>('/users/me/addresses', {
    method: 'POST',
    data: payload,
    token,
    signal,
  });
}

/** 更新本人地址字段或默认状态。 */
export function updateUserAddress(
  token: string,
  addressId: string,
  payload: UpdateUserAddressPayload,
  signal?: AbortSignal,
): Promise<UserAddress> {
  return apiRequest<UserAddress>(
    `/users/me/addresses/${encodeURIComponent(addressId)}`,
    {
      method: 'PATCH',
      data: payload,
      token,
      signal,
    },
  );
}

/** 删除本人地址。 */
export function deleteUserAddress(
  token: string,
  addressId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(
    `/users/me/addresses/${encodeURIComponent(addressId)}`,
    {
      method: 'DELETE',
      token,
      signal,
    },
  );
}
