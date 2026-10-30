import type { User } from './users';

/** 登录接口请求参数。 */
export interface LoginPayload {
  email: string;
  password: string;
  captchaChallengeId: string;
  captchaAnswer: string;
}

/** 登录图片验证码响应。 */
export interface CaptchaResponse {
  challengeId: string;
  imageData: string;
  type: 'image';
}

/** 注册接口请求参数。 */
export interface RegisterPayload {
  email: string;
  password: string;
  displayName: string;
}

/** 登录、注册和刷新 Token 接口的统一响应。 */
export interface AuthResponse {
  /** 短期访问令牌，客户端用于 Bearer 鉴权。 */
  accessToken: string;
  /** 当前登录用户的脱敏资料。 */
  user: User;
}
