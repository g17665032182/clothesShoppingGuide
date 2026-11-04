import { Injectable } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';

import {
  UserPreference,
  UserPreferenceSourceStatus,
} from '../entity/user-preference.entity.js';
import type { UserPreferencesLifecycle } from '../port/user-preferences.port.js';
import { lockPreferenceUser } from '../task/preference-user-lock.js';

@Injectable()
export class UserPreferenceLifecycleService implements UserPreferencesLifecycle {
  public async markConversationDeleted(
    entityManager: EntityManager,
    conversationId: string,
    userId: string,
  ): Promise<void> {
    // 先取得领域锁，再改来源行；避免会话外键更新任务与提取形成反向锁序。
    await lockPreferenceUser(entityManager, userId);
    await entityManager.nativeUpdate(
      UserPreference,
      { sourceConversationId: conversationId, userId },
      { sourceStatus: UserPreferenceSourceStatus.DELETED },
    );
  }
}
