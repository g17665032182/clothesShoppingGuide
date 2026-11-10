/** 本人地址簿中的单条收货地址。 */
export interface UserAddress {
  id: string;
  recipientName: string;
  phone: string;
  address: string;
  label: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 地址列表分页结果。 */
export interface UserAddressPage {
  items: UserAddress[];
  total: number;
  page: number;
  pageSize: number;
}

/** 地址列表查询条件。 */
export interface UserAddressQuery {
  page: number;
  pageSize: number;
}

/** 新建地址字段；幂等键由页面为每次新增生成。 */
export interface CreateUserAddressPayload {
  requestKey: string;
  recipientName: string;
  phone: string;
  address: string;
  label?: string | null;
  isDefault?: boolean;
}

/** 修改本人地址时允许更新的字段。 */
export interface UpdateUserAddressPayload {
  recipientName?: string;
  phone?: string;
  address?: string;
  label?: string | null;
  isDefault?: boolean;
}

/** 地址表单字段，不包含服务端生成的标识和时间。 */
export type UserAddressFormValue = Omit<CreateUserAddressPayload, 'requestKey'>;
