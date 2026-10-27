import type { User } from './users';

export interface AuthResponse {
  accessToken: string;
  user: User;
}
