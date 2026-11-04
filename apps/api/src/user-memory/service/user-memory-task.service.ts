import { Injectable } from '@nestjs/common';
import { LockMode, sql, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';

import type {
  EnqueueMemoryTaskInput,
  UserMemoryTasks,
} from '../port/user-memory.port.js';
import type { MemoryDocumentOperation } from '../context/memory-document-patch.schema.js';
import { UserMemorySetting } from '../entity/user-memory-setting.entity.js';
import { UserMemoryDocumentState } from '../entity/user-memory-document-state.entity.js';
import {
  MEMORY_TASK_BATCH_SIZE,
  MEMORY_TASK_PROCESSING_TIMEOUT_MS,
} from '../task/memory-task-claim.js';
import {
  MEMORY_TASK_MAX_ATTEMPTS,
  memoryTaskRetryDelay,
} from '../task/memory-task-backoff.js';
import { memoryTaskLeaseWhere } from '../task/memory-task-lease.js';
import {
  UserMemoryTask,
  UserMemoryTaskStatus,
} from '../entity/user-memory-task.entity.js';

@Injectable()
export class UserMemoryTaskService implements UserMemoryTasks {
  public constructor(
    @InjectRepository(UserMemoryTask)
    private readonly tasks: EntityRepository<UserMemoryTask>,
  ) {}

  public async enqueueInTransaction(
    entityManager: EntityManager,
    input: EnqueueMemoryTaskInput,
  ): Promise<void> {
    const now = new Date();
    const transactionContext = entityManager.getTransactionContext();
    const connection = entityManager.getConnection();
    await connection.execute(
      'select pg_advisory_xact_lock(hashtextextended(?, 0))',
      [`user-memory-document:${input.userId}`],
      'run',
      transactionContext,
    );
    const [setting] = await connection.execute<Array<{ enabled: boolean }>>(
      'select enabled from user_memory_settings where user_id = ?',
      [input.userId],
      'all',
      transactionContext,
    );
    if (setting?.enabled === false) return;
    const [state] = await connection.execute<
      Array<{ document_generation: number }>
    >(
      'select document_generation from user_memory_document_states where user_id = ?',
      [input.userId],
      'all',
      transactionContext,
    );
    // 立即入队与领取共用数据库时钟，避免跨进程时钟偏差推迟首次领取。
    await connection.execute(
      `insert into user_memory_tasks (
         id, user_id, conversation_id, user_message_id, assistant_message_id,
         deduplication_key, document_generation, status, attempts, available_at,
         locked_at, last_error_code, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, 0, now(), null, null, ?, ?)
       on conflict (deduplication_key) do nothing`,
      [
        randomUUID(),
        input.userId,
        input.conversationId,
        input.userMessageId,
        input.assistantMessageId,
        `${input.conversationId}:${input.userMessageId}`,
        state?.document_generation ?? 0,
        UserMemoryTaskStatus.PENDING,
        now,
        now,
      ],
      'run',
      transactionContext,
    );
  }

  public async claimBatch(): Promise<UserMemoryTask[]> {
    const entityManager = this.tasks.getEntityManager().fork();
    return entityManager.transactional(async (transaction) => {
      const rows = await transaction
        .getConnection()
        .execute<Array<{ id: string }>>(
          `with ready as (
           select id from user_memory_tasks
           where status in ('pending', 'failed') and available_at <= now() and attempts < ?
           order by available_at asc, created_at asc limit ? for update skip locked
         )
         update user_memory_tasks as task set status = 'processing',
           attempts = task.attempts + 1, locked_at = date_trunc('milliseconds', now()), updated_at = now()
         from ready where task.id = ready.id returning task.id`,
          [MEMORY_TASK_MAX_ATTEMPTS, MEMORY_TASK_BATCH_SIZE],
          'all',
          transaction.getTransactionContext(),
        );
      if (!rows.length) return [];
      return transaction.find(UserMemoryTask, {
        id: { $in: rows.map((row) => row.id) },
      });
    });
  }

  public async readCurrent(
    task: UserMemoryTask,
  ): Promise<UserMemoryTask | null> {
    return this.withLease(task, async (_transaction, current) => current);
  }

  public async saveCandidates(
    task: UserMemoryTask,
    operations: MemoryDocumentOperation[],
  ): Promise<boolean> {
    return (
      (await this.withLease(task, async (transaction, current) => {
        current.candidateOperations = operations;
        await transaction.flush();
        return true;
      })) ?? false
    );
  }

  private async withLease<T>(
    task: UserMemoryTask,
    callback: (
      transaction: EntityManager,
      current: UserMemoryTask,
    ) => Promise<T>,
  ): Promise<T | null> {
    if (!task.lockedAt) return null;
    const entityManager = this.tasks.getEntityManager().fork();
    return entityManager.transactional(async (transaction) => {
      await transaction
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`user-memory-document:${task.userId}`],
          'run',
          transaction.getTransactionContext(),
        );
      const current = await transaction.findOne(
        UserMemoryTask,
        memoryTaskLeaseWhere(task),
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!current) return null;
      const setting = await transaction.findOne(UserMemorySetting, {
        userId: task.userId,
      });
      const state = await transaction.findOne(UserMemoryDocumentState, {
        userId: task.userId,
      });
      if (
        setting?.enabled === false ||
        (state?.documentGeneration ?? 0) !== task.documentGeneration
      ) {
        current.candidateOperations = null;
        await transaction.flush();
        return null;
      }
      return callback(transaction, current);
    });
  }

  public async markSucceeded(task: UserMemoryTask): Promise<void> {
    if (!task.lockedAt) return;
    await this.tasks
      .getEntityManager()
      .fork()
      .nativeUpdate(UserMemoryTask, memoryTaskLeaseWhere(task), {
        status: UserMemoryTaskStatus.SUCCEEDED,
        lockedAt: null,
        lastErrorCode: null,
        candidateOperations: null,
        updatedAt: new Date(),
      });
  }

  public async markFailed(
    task: UserMemoryTask,
    errorCode: string,
  ): Promise<void> {
    if (!task.lockedAt) return;
    await this.tasks
      .getEntityManager()
      .fork()
      .nativeUpdate(UserMemoryTask, memoryTaskLeaseWhere(task), {
        status: UserMemoryTaskStatus.FAILED,
        availableAt: new Date(Date.now() + memoryTaskRetryDelay(task.attempts)),
        lockedAt: null,
        lastErrorCode: errorCode.slice(0, 80),
        updatedAt: new Date(),
        ...(task.attempts >= MEMORY_TASK_MAX_ATTEMPTS
          ? { candidateOperations: null }
          : {}),
      });
  }

  public async recoverExpiredProcessing(): Promise<number> {
    const entityManager = this.tasks.getEntityManager().fork();
    const expired = {
      status: UserMemoryTaskStatus.PROCESSING,
      lockedAt: {
        $lt: new Date(Date.now() - MEMORY_TASK_PROCESSING_TIMEOUT_MS),
      },
    } as const;
    const terminal = await entityManager.nativeUpdate(
      UserMemoryTask,
      { ...expired, attempts: { $gte: MEMORY_TASK_MAX_ATTEMPTS } },
      {
        status: UserMemoryTaskStatus.FAILED,
        lockedAt: null,
        lastErrorCode: 'PROCESSING_TIMEOUT',
        candidateOperations: null,
        updatedAt: new Date(),
      },
    );
    const retry = await entityManager.nativeUpdate(
      UserMemoryTask,
      { ...expired, attempts: { $lt: MEMORY_TASK_MAX_ATTEMPTS } },
      {
        status: UserMemoryTaskStatus.PENDING,
        // 与领取条件共用数据库时钟，恢复后不受应用时钟毫秒级偏差影响。
        availableAt: sql.now(),
        lockedAt: null,
        lastErrorCode: 'PROCESSING_TIMEOUT',
        updatedAt: new Date(),
      },
    );
    return terminal + retry;
  }
}
