import type {
  RecommendationSourceSearchInput,
  RecommendationSourceSearchResult,
} from '../context/recommendation-source.schema.js';

export const RECOMMENDATION_PRODUCT_SOURCE = Symbol(
  'RECOMMENDATION_PRODUCT_SOURCE',
);

export interface RecommendationProductSource {
  readonly sourceId: string;
  readonly sourceType: 'local_catalog' | 'online_api' | 'mcp';
  readonly enabled: boolean;
  search(
    input: RecommendationSourceSearchInput,
  ): Promise<RecommendationSourceSearchResult>;
}

export type RecommendationProductSourcePort = RecommendationProductSource;
