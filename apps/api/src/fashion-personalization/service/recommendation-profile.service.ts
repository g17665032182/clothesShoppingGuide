import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import {
  type RecommendationProfileResponse,
  type RecommendationProfileTag,
} from '../dto/recommendation-profile.dto.js';
import type { RecommendationProfileSignals } from '../context/recommendation-safety.js';
import { RecommendationFeedback } from '../entity/recommendation-feedback.entity.js';
import { RecommendationProfile } from '../entity/recommendation-profile.entity.js';
import { RecommendationSetting } from '../entity/recommendation-setting.entity.js';
import { RecommendationProfileTask } from '../entity/recommendation-profile-task.entity.js';
import { RecommendationProfileTaskService } from '../task/recommendation-profile-task.service.js';
import { RECOMMENDATION_FEEDBACK_RETENTION_DAYS } from '../task/recommendation-task-constants.js';

type FeedbackSignal = {
  positive: number;
  negative: number;
  evidence: number;
};

@Injectable()
export class RecommendationProfileService {
  public constructor(
    @InjectRepository(RecommendationProfile)
    private readonly profiles: EntityRepository<RecommendationProfile>,
    @InjectRepository(RecommendationSetting)
    private readonly settings: EntityRepository<RecommendationSetting>,
    private readonly tasks: RecommendationProfileTaskService,
  ) {}

  public async get(userId: string): Promise<RecommendationProfileResponse> {
    const [profile, setting] = await Promise.all([
      this.profiles.findOne({ userId }),
      this.settings.findOne({ userId }),
    ]);
    return {
      preferredStyles: this.tags(profile?.preferredStyles ?? []),
      avoidedStyles: this.tags(profile?.avoidedStyles ?? []),
      preferredOccasions: this.tags(profile?.preferredOccasions ?? []),
      priceSensitivity: profile?.priceSensitivity ?? null,
      silhouetteSignals: this.tags(profile?.silhouetteSignals ?? []),
      evidenceCount: profile?.evidenceCount ?? 0,
      version: profile?.version ?? 1,
      generation: profile?.generation ?? 0,
      updatedAt: profile?.updatedAt?.toISOString() ?? null,
      learningEnabled: setting?.enabled ?? true,
    };
  }

  /** 只把有限的画像信号提供给排序器，不暴露画像实体或原始 JSON。 */
  public async getSignals(
    userId: string,
  ): Promise<RecommendationProfileSignals> {
    const profile = await this.profiles.findOne({ userId });
    if (!profile) return {};
    const labels = (value: Array<Record<string, unknown>>): string[] =>
      value
        .filter((item) => typeof item.label === 'string')
        .map((item) => String(item.label).slice(0, 64));
    const priceSensitivity =
      profile.priceSensitivity === 'low' ||
      profile.priceSensitivity === 'medium' ||
      profile.priceSensitivity === 'high'
        ? profile.priceSensitivity
        : null;
    return {
      preferredStyles: labels(profile.preferredStyles),
      avoidedStyles: labels(profile.avoidedStyles),
      preferredOccasions: labels(profile.preferredOccasions),
      silhouetteSignals: labels(profile.silhouetteSignals),
      priceSensitivity,
    };
  }

  public async clear(userId: string): Promise<void> {
    const em = this.profiles.getEntityManager().fork();
    await em.transactional(async (transaction) => {
      await transaction
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`recommendation-profile:${userId}`],
          'run',
          transaction.getTransactionContext(),
        );
      let profile = await transaction.findOne(RecommendationProfile, {
        userId,
      });
      if (!profile) {
        profile = transaction.create(RecommendationProfile, {
          userId,
          generation: 1,
          version: 1,
          preferredStyles: [],
          avoidedStyles: [],
          preferredOccasions: [],
          silhouetteSignals: [],
          evidenceCount: 0,
          priceSensitivity: null,
          updatedAt: new Date(),
        });
        transaction.persist(profile);
      } else {
        profile.generation += 1;
        profile.version += 1;
        profile.preferredStyles = [];
        profile.avoidedStyles = [];
        profile.preferredOccasions = [];
        profile.silhouetteSignals = [];
        profile.priceSensitivity = null;
        profile.evidenceCount = 0;
        profile.updatedAt = new Date();
      }
      await transaction.nativeDelete(RecommendationFeedback, { userId });
      await this.tasks.cancelForUser(transaction, userId, profile.generation);
      await transaction.flush();
    });
  }

  public async process(task: RecommendationProfileTask): Promise<void> {
    const em = this.profiles.getEntityManager().fork();
    await em.transactional(async (transaction) => {
      await transaction
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`recommendation-profile:${task.userId}`],
          'run',
          transaction.getTransactionContext(),
        );
      const setting = await transaction.findOne(RecommendationSetting, {
        userId: task.userId,
      });
      const profile = await transaction.findOne(RecommendationProfile, {
        userId: task.userId,
      });
      if (
        setting?.enabled === false ||
        !profile ||
        profile.generation !== task.generation
      )
        return;
      const since = new Date(
        Date.now() - RECOMMENDATION_FEEDBACK_RETENTION_DAYS * 86_400_000,
      );
      const events = await transaction.find(
        RecommendationFeedback,
        { userId: task.userId, createdAt: { $gte: since } },
        { orderBy: { createdAt: 'asc' } },
      );
      const next = this.aggregate(events);
      profile.preferredStyles = next.preferredStyles;
      profile.avoidedStyles = next.avoidedStyles;
      profile.preferredOccasions = next.preferredOccasions;
      profile.silhouetteSignals = next.silhouetteSignals;
      profile.priceSensitivity = next.priceSensitivity;
      profile.evidenceCount = events.length;
      profile.version += 1;
      profile.updatedAt = new Date();
      await transaction.flush();
    });
  }

  private aggregate(events: RecommendationFeedback[]) {
    const styles = new Map<string, FeedbackSignal>();
    const occasions = new Map<string, FeedbackSignal>();
    const silhouettes = new Map<string, FeedbackSignal>();
    const prices = new Map<string, FeedbackSignal>();
    for (const event of events) {
      const positive = event.feedbackType === 'positive' ? 1 : 0;
      const negative = event.feedbackType === 'negative' ? 1 : 0;
      const source = { positive, negative, evidence: 1 };
      for (const value of this.values(event.requestSnapshot, 'styles'))
        this.add(styles, value, source);
      for (const value of this.values(event.requestSnapshot, 'occasion'))
        this.add(occasions, value, source);
      for (const value of this.values(event.targetSnapshot, 'fit'))
        this.add(silhouettes, value, source);
      if (event.reasonCode === 'price' && event.feedbackType === 'negative') {
        this.add(prices, 'high', source);
      }
    }
    return {
      preferredStyles: this.toTags(styles, true),
      avoidedStyles: this.toTags(styles, false),
      preferredOccasions: this.toTags(occasions, true),
      silhouetteSignals: this.toTags(silhouettes, true),
      priceSensitivity: this.toTags(prices, true)[0]?.label ?? null,
    };
  }

  private values(
    snapshot: Record<string, unknown> | null,
    key: string,
  ): string[] {
    if (!snapshot) return [];
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim())
      return [value.trim().slice(0, 64)];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
      return value.slice(0, 5).map((item) => item.trim().slice(0, 64));
    return [];
  }

  private add(
    map: Map<string, FeedbackSignal>,
    label: string,
    signal: FeedbackSignal,
  ): void {
    const current = map.get(label) ?? { positive: 0, negative: 0, evidence: 0 };
    current.positive += signal.positive;
    current.negative += signal.negative;
    current.evidence += signal.evidence;
    map.set(label, current);
  }

  private toTags(
    map: Map<string, FeedbackSignal>,
    positive: boolean,
  ): RecommendationProfileTag[] {
    return [...map.entries()]
      .map(([label, signal]) => ({
        label,
        confidence: Number(
          Math.min(
            0.95,
            Math.max(
              0,
              (positive ? signal.positive : signal.negative) /
                Math.max(signal.evidence, 1),
            ),
          ).toFixed(3),
        ),
        evidenceCount: signal.evidence,
      }))
      .filter((item) => item.confidence > 0)
      .sort(
        (a, b) =>
          b.confidence - a.confidence ||
          b.evidenceCount - a.evidenceCount ||
          a.label.localeCompare(b.label),
      )
      .slice(0, 20);
  }

  private tags(
    value: Array<Record<string, unknown>>,
  ): RecommendationProfileTag[] {
    return value
      .filter(
        (item): item is RecommendationProfileTag =>
          typeof item.label === 'string' &&
          typeof item.confidence === 'number' &&
          typeof item.evidenceCount === 'number',
      )
      .map((item) => ({
        label: item.label,
        confidence: item.confidence,
        evidenceCount: item.evidenceCount,
      }));
  }
}
