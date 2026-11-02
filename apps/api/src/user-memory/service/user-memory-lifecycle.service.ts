import { Injectable } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import {
  UserMemory,
  UserMemorySourceStatus,
} from '../entity/user-memory.entity.js';

@Injectable()
export class UserMemoryLifecycleService {
  public constructor(
    @InjectRepository(UserMemory)
    private readonly memories: EntityRepository<UserMemory>,
  ) {}

  public async markConversationDeleted(
    conversationId: string,
    entityManager?: EntityManager,
  ): Promise<void> {
    const where = { sourceConversationId: conversationId };
    const update = { sourceStatus: UserMemorySourceStatus.DELETED };
    if (entityManager) {
      await entityManager.nativeUpdate(UserMemory, where, update);
      return;
    }
    await this.memories.nativeUpdate(where, update);
  }

  public async markConversationUnavailable(
    conversationId: string,
  ): Promise<void> {
    await this.memories.nativeUpdate(
      { sourceConversationId: conversationId },
      { sourceStatus: UserMemorySourceStatus.UNAVAILABLE },
    );
  }
}
