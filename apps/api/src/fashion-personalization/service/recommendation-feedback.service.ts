import { createHash } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import {
  type RecommendationFeedbackInput,
  type RecommendationFeedbackResponse,
} from '../dto/recommendation-feedback.dto.js';
import { RecommendationFeedback } from '../entity/recommendation-feedback.entity.js';
import { RecommendationSetting } from '../entity/recommendation-setting.entity.js';
import { RecommendationGroupService } from './recommendation-group.service.js';
import { RecommendationProfileTaskService } from '../task/recommendation-profile-task.service.js';
import { containsSensitiveText } from '../../common/security/sensitive-text.js';

@Injectable()
export class RecommendationFeedbackService {
  public constructor(
    @InjectRepository(RecommendationFeedback)
    private readonly feedback: EntityRepository<RecommendationFeedback>,
    private readonly groups: RecommendationGroupService,
    private readonly tasks: RecommendationProfileTaskService,
  ) {}

  public async submit(
    userId: string,
    input: RecommendationFeedbackInput,
  ): Promise<RecommendationFeedbackResponse> {
    if (input.note && containsSensitiveText(input.note)) {
      throw new BadRequestException('反馈内容包含不允许保存的信息');
    }
    const owned = await this.groups.lookupOwnedTarget(userId, input);
    const idempotencyKey = createHash('sha256')
      .update(
        JSON.stringify({
          userId,
          recommendationId: input.recommendationId,
          targetType: input.targetType,
          targetRef: input.targetRef,
          feedbackType: input.feedbackType,
          reasonCode: input.reasonCode ?? null,
        }),
      )
      .digest('hex');
    const em = this.feedback.getEntityManager().fork();
    return em.transactional(async (transaction) => {
      await transaction
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`recommendation-profile:${userId}`],
          'run',
          transaction.getTransactionContext(),
        );
      const setting = await transaction.findOne(RecommendationSetting, {
        userId,
      });
      if (setting?.enabled === false) {
        return { accepted: false, reason: 'learning_disabled' };
      }
      const repository = transaction.getRepository(RecommendationFeedback);
      const existing = await repository.findOne({ idempotencyKey });
      if (existing) return { accepted: true, feedbackId: existing.id };
      const event = repository.create({
        userId,
        recommendationId: input.recommendationId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        targetType: input.targetType,
        targetRef: input.targetRef,
        feedbackType: input.feedbackType,
        reasonCode: input.reasonCode ?? null,
        note: input.note ?? null,
        requestSnapshot: this.safeSnapshot(owned.group.intentSnapshot),
        targetSnapshot: this.safeSnapshot(owned.target.snapshot),
        idempotencyKey,
        createdAt: new Date(),
      });
      transaction.persist(event);
      await transaction.flush();
      await this.tasks.enqueueInTransaction(transaction, userId);
      return { accepted: true, feedbackId: event.id };
    });
  }

  private safeSnapshot(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of [
      'styles',
      'style',
      'occasion',
      'fit',
      'category',
      'budgetMax',
    ]) {
      const item = value[key];
      if (
        typeof item === 'string' ||
        typeof item === 'number' ||
        (Array.isArray(item) &&
          item.every((entry) => typeof entry === 'string'))
      ) {
        result[key] = Array.isArray(item) ? item.slice(0, 5) : item;
      }
    }
    return result;
  }
}
