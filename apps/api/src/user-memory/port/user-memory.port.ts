import type { EntityManager } from '@mikro-orm/core';

export const USER_MEMORY_READER = Symbol('USER_MEMORY_READER');
export const USER_MEMORY_TASKS = Symbol('USER_MEMORY_TASKS');

export type EnqueueMemoryTaskInput = {
  userId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
};

export interface UserMemoryReader {
  readContext(userId: string, currentMessage: string): Promise<string>;
}

export interface UserMemoryTasks {
  enqueueInTransaction(
    entityManager: EntityManager,
    input: EnqueueMemoryTaskInput,
  ): Promise<void>;
}
