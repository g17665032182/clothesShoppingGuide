import { Injectable } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';

import type { RecommendationProduct } from '../context/recommendation-source.schema.js';
import type { RecommendationTargetInput } from './recommendation-group.service.js';
import { RECOMMENDATION_FEEDBACK_RETENTION_DAYS } from '../task/recommendation-task-constants.js';
import { RecommendationGroupService } from './recommendation-group.service.js';
import { RecommendationOrchestratorService } from './recommendation-orchestrator.service.js';
import { RecommendationProfileService } from './recommendation-profile.service.js';
import {
  RecommendationSourceRegistryService,
  type RecommendationRequestScope,
} from './recommendation-source-registry.service.js';
import type { FashionRecommendationPort } from '../port/fashion-recommendation.port.js';

const SOURCE_NAMES: Record<string, string> = {
  local_catalog: '本地商品目录',
  pinduoduo: '拼多多',
  taobao: '淘宝',
};

@Injectable()
export class FashionRecommendationService implements FashionRecommendationPort {
  public constructor(
    private readonly registry: RecommendationSourceRegistryService,
    private readonly orchestrator: RecommendationOrchestratorService,
    private readonly profiles: RecommendationProfileService,
    private readonly groups: RecommendationGroupService,
  ) {}

  public createRequestScope(): RecommendationRequestScope {
    return this.registry.createScope();
  }

  public getProfileSignals(userId: string) {
    return this.profiles.getSignals(userId);
  }

  public recommend(input: {
    intent: Parameters<
      RecommendationOrchestratorService['recommend']
    >[0]['intent'];
    scope: RecommendationRequestScope;
    profile?: Parameters<
      RecommendationOrchestratorService['recommend']
    >[0]['profile'];
  }) {
    return this.orchestrator.recommend({
      intent: input.intent,
      scope: input.scope,
      ...(input.profile ? { profile: input.profile } : {}),
    });
  }

  public async persistInTransaction(
    entityManager: EntityManager,
    input: {
      userId: string;
      conversationId: string;
      assistantMessageId: string;
      scope: RecommendationRequestScope;
      intentSnapshot: Record<string, unknown>;
    },
  ): Promise<string | null> {
    if (input.scope.targets.length === 0) return null;
    const targets = flattenTargets(input.scope, input.intentSnapshot);
    const sourceSnapshot = collectSources(input.scope);
    return this.groups.persistInTransaction(entityManager, {
      id: input.scope.recommendationId,
      userId: input.userId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      intentSnapshot: input.intentSnapshot,
      targets,
      sourceSnapshot,
      expiresAt: new Date(
        Date.now() + RECOMMENDATION_FEEDBACK_RETENTION_DAYS * 86_400_000,
      ),
    });
  }
}

function flattenTargets(
  scope: RecommendationRequestScope,
  intentSnapshot: Record<string, unknown>,
): RecommendationTargetInput[] {
  const targets: RecommendationTargetInput[] = [
    {
      targetType: 'recommendation',
      targetRef: scope.recommendationId,
      snapshot: intentSnapshot,
    },
  ];
  for (const entry of scope.targets) {
    if (entry.type === 'item') {
      targets.push({
        targetType: 'item',
        targetRef: entry.target.targetRef,
        snapshot: productSnapshot(entry.target.product),
      });
      continue;
    }
    targets.push({
      targetType: 'outfit',
      targetRef: entry.target.targetRef,
      snapshot: {
        styleSummary: entry.target.styleSummary,
        missingSlots: entry.target.missingSlots,
        total: entry.target.total,
      },
    });
    for (const item of entry.target.items) {
      targets.push({
        targetType: 'slot',
        targetRef: item.targetRef,
        snapshot: {
          slot: item.slot,
          ...productSnapshot(item.product),
        },
      });
      targets.push({
        targetType: 'item',
        targetRef: item.targetRef,
        snapshot: productSnapshot(item.product),
      });
    }
  }
  return targets;
}

function productSnapshot(
  product: RecommendationProduct,
): Record<string, unknown> {
  return {
    sourceId: product.sourceId,
    sourceType: product.sourceType,
    sourceProductRef: product.sourceProductRef,
    category: product.category,
    styles: product.styles,
    occasion: product.occasions,
    fit: product.fits,
  };
}

function collectSources(
  scope: RecommendationRequestScope,
): Array<Record<string, unknown>> {
  const sources = new Map<string, Record<string, unknown>>();
  for (const entry of scope.targets) {
    const products =
      entry.type === 'item'
        ? [entry.target.product]
        : entry.target.items.map((item) => item.product);
    for (const product of products) {
      const key = `${product.sourceType}:${product.sourceId}`;
      sources.set(key, {
        sourceId: product.sourceId,
        sourceType: product.sourceType,
        sourceName: SOURCE_NAMES[product.sourceId] ?? product.sourceId,
        observedAt: product.observedAt,
      });
    }
  }
  return [...sources.values()];
}
