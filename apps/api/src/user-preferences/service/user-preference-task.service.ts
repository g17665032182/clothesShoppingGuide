import { Injectable } from '@nestjs/common';
import { LockMode, sql, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';

import {
  PREFERENCE_TASK_BATCH_SIZE,
  PREFERENCE_TASK_PROCESSING_TIMEOUT_MS,
} from '../task/preference-task-claim.js';
import {
  PREFERENCE_TASK_MAX_ATTEMPTS,
  preferenceTaskRetryDelay,
} from '../task/preference-task-backoff.js';
import {
  UserPreferenceTask,
  UserPreferenceTaskStatus,
} from '../entity/user-preference-task.entity.js';
import { UserPreferenceSetting } from '../entity/user-preference-setting.entity.js';
import type {
  EnqueuePreferenceTaskInput,
  UserPreferencesTasks,
} from '../port/user-preferences.port.js';
import type { PreferenceOperation } from '../context/preference-candidate.schema.js';
import { lockPreferenceUser } from '../task/preference-user-lock.js';

export function preferenceLeaseWhere(task: UserPreferenceTask) {
  return {
    id: task.id,
    status: UserPreferenceTaskStatus.PROCESSING,
    attempts: task.attempts,
    lockedAt: task.lockedAt,
  };
}

@Injectable()
export class UserPreferenceTaskService implements UserPreferencesTasks {
  public constructor(
    @InjectRepository(UserPreferenceTask)
    private readonly tasks: EntityRepository<UserPreferenceTask>,
  ) {}

  public async enqueueInTransaction(
    entityManager: EntityManager,
    input: EnqueuePreferenceTaskInput,
  ): Promise<void> {
    await lockPreferenceUser(entityManager, input.userId);
    const setting = await entityManager.findOne(
      UserPreferenceSetting,
      { userId: input.userId },
      { refresh: true },
    );
    if (setting?.enabled === false) return;
    const now = new Date();
    // 立即入队与领取共用数据库时钟，避免跨进程时钟偏差推迟首次领取。
    await entityManager.getConnection().execute(
      `insert into user_preference_tasks (
         id, user_id, conversation_id, user_message_id, assistant_message_id,
         deduplication_key, status, attempts, available_at, locked_at,
         last_error_code, created_at, updated_at, candidate_operations
       ) values (?, ?, ?, ?, ?, ?, 'pending', 0, now(), null, null, ?, ?, null)
       on conflict (deduplication_key) do nothing`,
      [
        randomUUID(),
        input.userId,
        input.conversationId,
        input.userMessageId,
        input.assistantMessageId,
        `${input.conversationId}:${input.userMessageId}`,
        now,
        now,
      ],
      'run',
      entityManager.getTransactionContext(),
    );
  }

  public async claimBatch(): Promise<UserPreferenceTask[]> {
    const entityManager = this.tasks.getEntityManager().fork();
    return entityManager.transactional(async (transaction) => {
      const rows = await transaction
        .getConnection()
        .execute<Array<{ id: string }>>(
          `with ready as (
           select id from user_preference_tasks
           where status in ('pending', 'failed') and available_at <= now()
             and attempts < ?
           order by available_at asc, created_at asc
           limit ? for update skip locked
         )
         update user_preference_tasks as task
         set status = 'processing', attempts = task.attempts + 1,
             locked_at = date_trunc('milliseconds', clock_timestamp()),
             updated_at = now()
         from ready where task.id = ready.id returning task.id`,
          [PREFERENCE_TASK_MAX_ATTEMPTS, PREFERENCE_TASK_BATCH_SIZE],
          'all',
          transaction.getTransactionContext(),
        );
      if (!rows.length) return [];
      return transaction.find(UserPreferenceTask, {
        id: { $in: rows.map(({ id }) => id) },
      });
    });
  }

  public async current(
    transaction: EntityManager,
    task: UserPreferenceTask,
  ): Promise<UserPreferenceTask | null> {
    if (!task.lockedAt) return null;
    return transaction.findOne(UserPreferenceTask, preferenceLeaseWhere(task), {
      lockMode: LockMode.PESSIMISTIC_WRITE,
      refresh: true,
    });
  }

  public async saveCandidate(
    task: UserPreferenceTask,
    operations: PreferenceOperation[],
  ): Promise<PreferenceOperation[] | null> {
    return this.tasks
      .getEntityManager()
      .fork()
      .transactional(async (em) => {
        await lockPreferenceUser(em, task.userId);
        const current = await this.current(em, task);
        if (!current) return null;
        const setting = await em.findOne(UserPreferenceSetting, {
          userId: task.userId,
        });
        if (setting?.enabled === false) {
          current.candidateOperations = null;
          await em.flush();
          return null;
        }
        // 已缓存候选不可被重试生成的新内容替换，保证操作键与部分结果一致。
        current.candidateOperations ??= operations;
        await em.flush();
        return current.candidateOperations;
      });
  }

  public async markSucceeded(task: UserPreferenceTask): Promise<void> {
    await this.tasks
      .getEntityManager()
      .fork()
      .nativeUpdate(UserPreferenceTask, preferenceLeaseWhere(task), {
        status: UserPreferenceTaskStatus.SUCCEEDED,
        lockedAt: null,
        lastErrorCode: null,
        candidateOperations: null,
        updatedAt: new Date(),
      });
  }

  public async markFailed(
    task: UserPreferenceTask,
    errorCode: string,
  ): Promise<void> {
    await this.tasks
      .getEntityManager()
      .fork()
      .nativeUpdate(UserPreferenceTask, preferenceLeaseWhere(task), {
        status: UserPreferenceTaskStatus.FAILED,
        availableAt: new Date(
          Date.now() + preferenceTaskRetryDelay(task.attempts),
        ),
        lockedAt: null,
        lastErrorCode: errorCode.slice(0, 80),
        ...(task.attempts >= PREFERENCE_TASK_MAX_ATTEMPTS
          ? { candidateOperations: null }
          : {}),
        updatedAt: new Date(),
      });
  }

  public async recoverExpiredProcessing(): Promise<number> {
    const em = this.tasks.getEntityManager().fork();
    const cutoff = new Date(Date.now() - PREFERENCE_TASK_PROCESSING_TIMEOUT_MS);
    const expired = {
      status: UserPreferenceTaskStatus.PROCESSING,
      lockedAt: { $lt: cutoff },
    } as const;
    const terminalCount = await em.nativeUpdate(
      UserPreferenceTask,
      { ...expired, attempts: { $gte: PREFERENCE_TASK_MAX_ATTEMPTS } },
      {
        status: UserPreferenceTaskStatus.FAILED,
        lockedAt: null,
        candidateOperations: null,
        lastErrorCode: 'PROCESSING_TIMEOUT',
        updatedAt: new Date(),
      },
    );
    const retryCount = await em.nativeUpdate(
      UserPreferenceTask,
      { ...expired, attempts: { $lt: PREFERENCE_TASK_MAX_ATTEMPTS } },
      {
        status: UserPreferenceTaskStatus.PENDING,
        // 与领取条件共用数据库时钟，恢复后不受应用时钟毫秒级偏差影响。
        availableAt: sql.now(),
        lockedAt: null,
        lastErrorCode: 'PROCESSING_TIMEOUT',
        updatedAt: new Date(),
      },
    );
    return terminalCount + retryCount;
  }
}
