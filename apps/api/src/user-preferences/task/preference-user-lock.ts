import type { EntityManager } from '@mikro-orm/core';

export async function lockPreferenceUser(
  entityManager: EntityManager,
  userId: string,
): Promise<void> {
  // 所有偏好写入遵守同一用户锁；与记忆领域使用不同锁空间。
  await entityManager
    .getConnection()
    .execute(
      'select pg_advisory_xact_lock(hashtextextended(?, 0))',
      [`user-preferences:${userId}`],
      'run',
      entityManager.getTransactionContext(),
    );
}
