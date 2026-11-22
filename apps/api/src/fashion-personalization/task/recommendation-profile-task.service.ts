import { Injectable } from '@nestjs/common';
import { sql, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import {
  RecommendationProfileTask,
  RecommendationProfileTaskStatus,
} from '../entity/recommendation-profile-task.entity.js';
import { RecommendationProfile } from '../entity/recommendation-profile.entity.js';
import { RecommendationSetting } from '../entity/recommendation-setting.entity.js';
import { RecommendationFeedback } from '../entity/recommendation-feedback.entity.js';
import { RecommendationGroup } from '../entity/recommendation-group.entity.js';
import {
  RECOMMENDATION_PROFILE_TASK_BATCH_SIZE,
  RECOMMENDATION_PROFILE_TASK_DEBOUNCE_MS,
  RECOMMENDATION_PROFILE_TASK_MAX_ATTEMPTS,
  RECOMMENDATION_PROFILE_TASK_PROCESSING_TIMEOUT_MS,
  RECOMMENDATION_FEEDBACK_RETENTION_DAYS,
  recommendationTaskRetryDelay,
} from './recommendation-task-constants.js';
import { recommendationTaskLeaseWhere } from './recommendation-task-lease.js';

@Injectable()
export class RecommendationProfileTaskService {
  public constructor(
    @InjectRepository(RecommendationProfileTask)
    private readonly tasks: EntityRepository<RecommendationProfileTask>,
  ) {}

  public async enqueueInTransaction(
    entityManager: EntityManager,
    userId: string,
  ): Promise<void> {
    await entityManager
      .getConnection()
      .execute(
        'select pg_advisory_xact_lock(hashtextextended(?, 0))',
        [`recommendation-profile:${userId}`],
        'run',
        entityManager.getTransactionContext(),
      );
    const setting = await entityManager.findOne(RecommendationSetting, {
      userId,
    });
    if (setting?.enabled === false) return;
    const profile = await entityManager.findOne(RecommendationProfile, {
      userId,
    });
    const generation = profile?.generation ?? 0;
    const repository = entityManager.getRepository(RecommendationProfileTask);
    const existing = await repository.findOne({
      userId,
      generation,
      status: RecommendationProfileTaskStatus.PENDING,
      attempts: 0,
    });
    if (existing) {
      existing.availableAt = new Date(
        Date.now() + RECOMMENDATION_PROFILE_TASK_DEBOUNCE_MS,
      );
      existing.updatedAt = new Date();
      await entityManager.flush();
      return;
    }
    const task = repository.create({
      userId,
      generation,
      status: RecommendationProfileTaskStatus.PENDING,
      attempts: 0,
      availableAt: new Date(
        Date.now() + RECOMMENDATION_PROFILE_TASK_DEBOUNCE_MS,
      ),
      lockedAt: null,
      lockToken: null,
      lastErrorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    entityManager.persist(task);
    await entityManager.flush();
  }

  public async claimBatch(): Promise<RecommendationProfileTask[]> {
    const entityManager = this.tasks.getEntityManager().fork();
    return entityManager.transactional(async (transaction) => {
      const rows = await transaction
        .getConnection()
        .execute<Array<{ id: string }>>(
          `with ready as (
             select id from recommendation_profile_tasks
             where status in ('pending','failed')
               and available_at <= now()
               and attempts < ?
             order by available_at asc, created_at asc
             limit ? for update skip locked
           )
           update recommendation_profile_tasks as task
           set status = 'processing',
               attempts = task.attempts + 1,
               locked_at = date_trunc('milliseconds', now()),
               lock_token = task.id,
               updated_at = now()
           from ready where task.id = ready.id
           returning task.id`,
          [
            RECOMMENDATION_PROFILE_TASK_MAX_ATTEMPTS,
            RECOMMENDATION_PROFILE_TASK_BATCH_SIZE,
          ],
          'all',
          transaction.getTransactionContext(),
        );
      if (!rows.length) return [];
      return transaction.find(RecommendationProfileTask, {
        id: { $in: rows.map((row) => row.id) },
      });
    });
  }

  public async recoverExpiredProcessing(): Promise<void> {
    const cutoff = new Date(
      Date.now() - RECOMMENDATION_PROFILE_TASK_PROCESSING_TIMEOUT_MS,
    );
    await this.tasks.nativeUpdate(
      {
        status: RecommendationProfileTaskStatus.PROCESSING,
        lockedAt: { $lt: cutoff },
      },
      {
        status: RecommendationProfileTaskStatus.FAILED,
        lockedAt: null,
        lockToken: null,
        availableAt: new Date(),
        lastErrorCode: 'TASK_LEASE_EXPIRED',
        updatedAt: new Date(),
      },
    );
  }

  public async cleanupExpiredData(): Promise<void> {
    const cutoff = new Date(
      Date.now() - RECOMMENDATION_FEEDBACK_RETENTION_DAYS * 86_400_000,
    );
    await this.tasks.getEntityManager().transactional(async (transaction) => {
      await transaction.nativeDelete(RecommendationFeedback, {
        createdAt: { $lt: cutoff },
      });
      await transaction.nativeDelete(RecommendationGroup, {
        expiresAt: { $lt: new Date() },
      });
    });
  }

  public async markSucceeded(
    task: RecommendationProfileTask,
  ): Promise<boolean> {
    return this.updateLease(task, {
      status: RecommendationProfileTaskStatus.SUCCEEDED,
      lockedAt: null,
      lockToken: null,
      lastErrorCode: null,
      updatedAt: new Date(),
    });
  }

  public async markFailed(
    task: RecommendationProfileTask,
    errorCode: string,
  ): Promise<boolean> {
    const retryable = task.attempts < RECOMMENDATION_PROFILE_TASK_MAX_ATTEMPTS;
    return this.updateLease(task, {
      status: retryable
        ? RecommendationProfileTaskStatus.FAILED
        : RecommendationProfileTaskStatus.FAILED,
      lockedAt: null,
      lockToken: null,
      lastErrorCode: errorCode.slice(0, 80),
      availableAt: retryable
        ? new Date(Date.now() + recommendationTaskRetryDelay(task.attempts))
        : new Date(),
      updatedAt: new Date(),
    });
  }

  public async cancelForUser(
    entityManager: EntityManager,
    userId: string,
    nextGeneration: number,
  ): Promise<void> {
    await entityManager.nativeUpdate(
      RecommendationProfileTask,
      { userId },
      {
        generation: nextGeneration,
        status: RecommendationProfileTaskStatus.SUCCEEDED,
        lockedAt: null,
        lockToken: null,
        updatedAt: sql.now(),
      },
    );
  }

  private async updateLease(
    task: RecommendationProfileTask,
    changes: Partial<RecommendationProfileTask>,
  ): Promise<boolean> {
    const updated = await this.tasks.nativeUpdate(
      recommendationTaskLeaseWhere(task),
      changes,
    );
    return updated > 0;
  }
}
