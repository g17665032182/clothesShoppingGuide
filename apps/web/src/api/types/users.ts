export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'disabled';

/** 用户接口返回的脱敏资料。 */
export interface User {
  /** 用户 UUID。 */
  id: string;
  /** 登录邮箱。 */
  email: string;
  /** 用户显示名称。 */
  displayName: string;
  /** 用户角色。 */
  role: UserRole;
  /** 用户状态，disabled 表示已被管理员禁用。 */
  status: UserStatus;
  /** 创建时间，ISO 8601 字符串。 */
  createdAt: string;
  /** 最后更新时间，ISO 8601 字符串。 */
  updatedAt: string;
}

/** 当前用户资料更新参数。未传字段表示保持原值。 */
export interface UpdateProfilePayload {
  /** 新的显示名称。 */
  displayName?: string;
  /** 新密码，提交时必须满足后端密码校验规则。 */
  password?: string;
}

/** 管理员更新用户参数。 */
export interface AdminUpdateUserPayload {
  /** 新的显示名称。 */
  displayName?: string;
  /** 新的用户角色。 */
  role?: UserRole;
  /** 新的用户状态。 */
  status?: UserStatus;
}
