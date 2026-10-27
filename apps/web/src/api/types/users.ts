export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'disabled';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfilePayload {
  displayName?: string;
  password?: string;
}

export interface AdminUpdateUserPayload {
  displayName?: string;
  role?: UserRole;
  status?: UserStatus;
}
