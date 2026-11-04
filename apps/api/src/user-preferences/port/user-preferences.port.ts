import type { EntityManager } from '@mikro-orm/core';

export const USER_PREFERENCES_READER = Symbol('USER_PREFERENCES_READER');
export const USER_PREFERENCES_TASKS = Symbol('USER_PREFERENCES_TASKS');
export const USER_PREFERENCES_LIFECYCLE = Symbol('USER_PREFERENCES_LIFECYCLE');

export type EnqueuePreferenceTaskInput = {
  userId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
};

export interface UserPreferencesReader {
  readContext(userId: string, currentMessage: string): Promise<string>;
}

export interface UserPreferencesTasks {
  enqueueInTransaction(
    entityManager: EntityManager,
    input: EnqueuePreferenceTaskInput,
  ): Promise<void>;
}

export interface UserPreferencesLifecycle {
  markConversationDeleted(
    entityManager: EntityManager,
    conversationId: string,
    userId: string,
  ): Promise<void>;
}
