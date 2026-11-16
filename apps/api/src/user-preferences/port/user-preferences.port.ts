import type { EntityManager } from '@mikro-orm/core';

import type {
  PreferenceChatQuery,
  PreferenceChatResult,
} from '../dto/preference-chat-query.dto.js';

export const USER_PREFERENCES_READER = Symbol('USER_PREFERENCES_READER');
export const USER_PREFERENCES_LIFECYCLE = Symbol('USER_PREFERENCES_LIFECYCLE');

export interface UserPreferencesReader {
  readContext(userId: string, currentMessage: string): Promise<string>;
  listForChat(
    userId: string,
    query: PreferenceChatQuery,
  ): Promise<PreferenceChatResult>;
}

export interface UserPreferencesLifecycle {
  markConversationDeleted(
    entityManager: EntityManager,
    conversationId: string,
    userId: string,
  ): Promise<void>;
}
