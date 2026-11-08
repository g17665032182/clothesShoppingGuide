import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LockMode, sql, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import {
  CHAT_EXTRACTION_SOURCE,
  type ChatExtractionSource,
  type ChatExtractionTurn,
} from '../../chat-records/extraction-source/index.js';
import type {
  EnqueueMemoryTaskInput,
  UserMemoryTasks,
} from '../port/user-memory.port.js';
import type { MemoryDocumentOperation } from '../context/memory-document-patch.schema.js';
import { UserMemorySetting } from '../entity/user-memory-setting.entity.js';
import { UserMemoryDocumentState } from '../entity/user-memory-document-state.entity.js';
import {
  MEMORY_TASK_BATCH_SIZE,
  MEMORY_TASK_DEBOUNCE_MS,
  MEMORY_TASK_PROCESSING_TIMEOUT_MS,
  MEMORY_TASK_SOURCE_TURN_LIMIT,
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
    @Inject(CHAT_EXTRACTION_SOURCE)
    private readonly source: ChatExtractionSource,
  ) {}

  public async enqueueInTransaction(
    entityManager: EntityManager,
    input: EnqueueMemoryTaskInput,
  ): Promise<void> {
    const transactionContext = entityManager.getTransactionContext();
    const connection = entityManager.getConnection();
    // advisory lock 协调跨进程同用户写入；实体读写仍由 EntityManager 管理。
    await connection.execute(
      'select pg_advisory_xact_lock(hashtextextended(?, 0))',
      [`user-memory-document:${input.userId}`],
      'run',
      transactionContext,
    );
    const setting = await entityManager.findOne(UserMemorySetting, {
      userId: input.userId,
    });
    if (setting?.enabled === false) return;
    const state = await entityManager.findOne(UserMemoryDocumentState, {
      userId: input.userId,
    });
    const generation = state?.documentGeneration ?? 0;
    const deduplicationKey = `${input.conversationId}:${input.userMessageId}`;
    const existing = await entityManager.findOne(UserMemoryTask, {
      $or: [
        { deduplicationKey },
        {
          conversationId: input.conversationId,
          userMessageId: input.userMessageId,
        },
        {
          conversationId: input.conversationId,
          sourceTurns: {
            $elemMatch: { userMessageId: input.userMessageId },
          },
        },
      ],
    });
    if (existing) return;
    const mergeable = await entityManager.findOne(
      UserMemoryTask,
      {
        userId: input.userId,
        conversationId: input.conversationId,
        documentGeneration: generation,
        status: UserMemoryTaskStatus.PENDING,
        attempts: 0,
        candidateOperations: null,
        sourceTurns: { $ne: null },
      },
      {
        orderBy: { createdAt: 'DESC' },
        lockMode: LockMode.PESSIMISTIC_WRITE,
      },
    );
    if (
      mergeable?.sourceTurns &&
      mergeable.sourceTurns.length < MEMORY_TASK_SOURCE_TURN_LIMIT
    ) {
      const turns = mergeable.sourceTurns;
      const includesSource = turns.some(
        (turn) => turn.userMessageId === input.userMessageId,
      );
      if (!includesSource) {
        const sourceTurns = [
          ...turns,
          {
            userMessageId: input.userMessageId,
            assistantMessageId: input.assistantMessageId,
          },
        ];
        await entityManager.nativeUpdate(
          UserMemoryTask,
          {
            id: mergeable.id,
            status: UserMemoryTaskStatus.PENDING,
            attempts: 0,
            candidateOperations: null,
          },
          {
            sourceTurns,
            availableAt:
              sql`now() + ${MEMORY_TASK_DEBOUNCE_MS} * interval '1 millisecond'` as unknown as Date,
            updatedAt: sql.now(),
          },
        );
      }
      return;
    }
    // 所有实例共享数据库时钟，最后一轮写入后才开始 5 分钟静默期。
    entityManager.create(UserMemoryTask, {
      userId: input.userId,
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      sourceTurns: [
        {
          userMessageId: input.userMessageId,
          assistantMessageId: input.assistantMessageId,
        },
      ],
      deduplicationKey,
      documentGeneration: generation,
      status: UserMemoryTaskStatus.PENDING,
      attempts: 0,
      availableAt: new Date(),
      lockedAt: null,
      lastErrorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await entityManager.flush();
    await entityManager.nativeUpdate(
      UserMemoryTask,
      { deduplicationKey },
      {
        availableAt:
          sql`now() + ${MEMORY_TASK_DEBOUNCE_MS} * interval '1 millisecond'` as unknown as Date,
        updatedAt: sql.now(),
      },
    );
  }

  public async flush(userId: string, conversationId: string): Promise<void> {
    const entityManager = this.tasks.getEntityManager().fork();
    await entityManager.transactional(async (transaction) => {
      await transaction
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`user-memory-document:${userId}`],
          'run',
          transaction.getTransactionContext(),
        );
      if (
        !this.source.ownsConversation ||
        !(await this.source.ownsConversation({ userId, conversationId }))
      )
        throw new NotFoundException('会话不存在');
      await transaction.nativeUpdate(
        UserMemoryTask,
        {
          userId,
          conversationId,
          status: UserMemoryTaskStatus.PENDING,
          attempts: 0,
          candidateOperations: null,
        },
        { availableAt: sql.now(), updatedAt: sql.now() },
      );
    });
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

  public async normalizeSources(
    task: UserMemoryTask,
    sourceTurns: ChatExtractionTurn[],
  ): Promise<UserMemoryTask | null> {
    return this.withLease(task, async (transaction, current) => {
      const previous =
        current.sourceTurns ??
        (current.userMessageId && current.assistantMessageId
          ? [
              {
                userMessageId: current.userMessageId,
                assistantMessageId: current.assistantMessageId,
              },
            ]
          : []);
      const changed =
        current.sourceTurns === null ||
        JSON.stringify(previous) !== JSON.stringify(sourceTurns);
      if (changed) {
        current.sourceTurns = sourceTurns;
        current.candidateOperations = null;
        await transaction.flush();
      }
      return current;
    });
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
