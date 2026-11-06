import type { EntityManager } from '@mikro-orm/core';

export const USER_PREFERENCES_READER = Symbol('USER_PREFERENCES_READER');
export const USER_PREFERENCES_LIFECYCLE = Symbol('USER_PREFERENCES_LIFECYCLE');

export interface UserPreferencesReader {
  readContext(userId: string, currentMessage: string): Promise<string>;
}

export interface UserPreferencesLifecycle {
  markConversationDeleted(
    entityManager: EntityManager,
    conversationId: string,
    userId: string,
  ): Promise<void>;
}
