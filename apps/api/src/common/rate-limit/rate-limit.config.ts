export interface RateLimitConfig {
  defaultTtl: number;
  defaultLimit: number;
  authTtl: number;
  authLimit: number;
}

function readPositiveInteger(
  value: unknown,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

/**
 * 统一读取限流配置，避免模块装配和配置校验使用两套解析规则。
 */
export function parseRateLimitConfig(
  config: Record<string, unknown>,
): RateLimitConfig {
  return {
    defaultTtl: readPositiveInteger(
      config.RATE_LIMIT_TTL_MS,
      60_000,
      'RATE_LIMIT_TTL_MS',
    ),
    defaultLimit: readPositiveInteger(
      config.RATE_LIMIT_LIMIT,
      120,
      'RATE_LIMIT_LIMIT',
    ),
    authTtl: readPositiveInteger(
      config.AUTH_RATE_LIMIT_TTL_MS,
      60_000,
      'AUTH_RATE_LIMIT_TTL_MS',
    ),
    authLimit: readPositiveInteger(
      config.AUTH_RATE_LIMIT_LIMIT,
      10,
      'AUTH_RATE_LIMIT_LIMIT',
    ),
  };
}
