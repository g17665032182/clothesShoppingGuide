import type { EntityManager } from '@mikro-orm/core';

import type { RecommendationIntent } from '../context/recommendation-intent.schema.js';
import type { RecommendationProfileSignals } from '../context/recommendation-safety.js';
import type { RecommendationResult } from '../service/recommendation-orchestrator.service.js';
import type { RecommendationRequestScope } from '../service/recommendation-source-registry.service.js';

export const FASHION_RECOMMENDATION_PORT = Symbol(
  'FASHION_RECOMMENDATION_PORT',
);

export type FashionRecommendationPort = {
  createRequestScope(): RecommendationRequestScope;
  getProfileSignals(userId: string): Promise<RecommendationProfileSignals>;
  recommend(input: {
    intent: RecommendationIntent;
    scope: RecommendationRequestScope;
    profile?: RecommendationProfileSignals;
  }): Promise<RecommendationResult>;
  persistInTransaction(
    entityManager: EntityManager,
    input: {
      userId: string;
      conversationId: string;
      assistantMessageId: string;
      scope: RecommendationRequestScope;
      intentSnapshot: Record<string, unknown>;
    },
  ): Promise<string | null>;
};
