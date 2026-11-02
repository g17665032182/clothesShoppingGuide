import { Injectable } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';

import {
  MEMORY_TASK_BATCH_SIZE,
  MEMORY_TASK_PROCESSING_TIMEOUT_MS,
} from '../task/memory-task-claim.js';
import {
  MEMORY_TASK_MAX_ATTEMPTS,
  memoryTaskRetryDelay,
} from '../task/memory-task-backoff.js';
import {
  UserMemoryTask,
  UserMemoryTaskStatus,
} from '../entity/user-memory-task.entity.js';

export type EnqueueMemoryTaskInput = {
  userId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
};

@Injectable()
export class UserMemoryTaskService {
  public constructor(
    @InjectRepository(UserMemoryTask)
    private readonly tasks: EntityRepository<UserMemoryTask>,
  ) {}

  public async enqueueInTransaction(
    entityManager: EntityManager,
    input: EnqueueMemoryTaskInput,
  ): Promise<void> {
    const now = new Date();
    const deduplicationKey = `${input.conversationId}:${input.userMessageId}`;
    await entityManager.getConnection().execute(
      `insert into user_memory_tasks (
         id, user_id, conversation_id, user_message_id, assistant_message_id,
         deduplication_key, status, attempts, available_at, locked_at,
         last_error_code, created_at, updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, 0, ?, null, null, ?, ?)
       on conflict (deduplication_key) do nothing`,
      [
        randomUUID(),
        input.userId,
        input.conversationId,
        input.userMessageId,
        input.assistantMessageId,
        deduplicationKey,
        UserMemoryTaskStatus.PENDING,
        now,
        now,
        now,
      ],
      'run',
      entityManager.getTransactionContext(),
    );
  }

  public async claimBatch(): Promise<UserMemoryTask[]> {
    const entityManager = this.tasks.getEntityManager().fork();
    const claimedIds = await entityManager.transactional(
      async (transaction) => {
        const rows = await transaction
          .getConnection()
          .execute<Array<{ id: string }>>(
            `with ready as (
           select id
           from user_memory_tasks
           where status in ('pending', 'failed')
             and available_at <= now()
             and attempts < ?
           order by available_at asc, created_at asc
           limit ?
           for update skip locked
         )
         update user_memory_tasks as task
         set status = 'processing',
             attempts = task.attempts + 1,
             locked_at = now(),
             updated_at = now()
         from ready
         where task.id = ready.id
         returning task.id`,
            [MEMORY_TASK_MAX_ATTEMPTS, MEMORY_TASK_BATCH_SIZE],
            'all',
            transaction.getTransactionContext(),
          );
        return rows.map((row) => row.id);
      },
    );
    if (claimedIds.length === 0) return [];
    return this.tasks.find({ id: { $in: claimedIds } });
  }

  public async markSucceeded(taskId: string): Promise<void> {
    await this.tasks.nativeUpdate(
      { id: taskId, status: UserMemoryTaskStatus.PROCESSING },
      {
        status: UserMemoryTaskStatus.SUCCEEDED,
        lockedAt: null,
        lastErrorCode: null,
      },
    );
  }

  public async markFailed(
    task: UserMemoryTask,
    errorCode: string,
  ): Promise<void> {
    await this.tasks.nativeUpdate(
      { id: task.id, status: UserMemoryTaskStatus.PROCESSING },
      {
        status: UserMemoryTaskStatus.FAILED,
        availableAt: new Date(Date.now() + memoryTaskRetryDelay(task.attempts)),
        lockedAt: null,
        lastErrorCode: errorCode.slice(0, 80),
      },
    );
  }

  public async recoverExpiredProcessing(): Promise<number> {
    const cutoff = new Date(Date.now() - MEMORY_TASK_PROCESSING_TIMEOUT_MS);
    const expired = {
      status: UserMemoryTaskStatus.PROCESSING,
      lockedAt: { $lt: cutoff },
    } as const;
    const terminalCount = await this.tasks.nativeUpdate(
      { ...expired, attempts: { $gte: MEMORY_TASK_MAX_ATTEMPTS } },
      {
        status: UserMemoryTaskStatus.FAILED,
        lockedAt: null,
        lastErrorCode: 'PROCESSING_TIMEOUT',
      },
    );
    const retryCount = await this.tasks.nativeUpdate(
      { ...expired, attempts: { $lt: MEMORY_TASK_MAX_ATTEMPTS } },
      {
        status: UserMemoryTaskStatus.PENDING,
        availableAt: new Date(),
        lockedAt: null,
        lastErrorCode: 'PROCESSING_TIMEOUT',
      },
    );
    return terminalCount + retryCount;
  }
}
