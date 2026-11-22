import { randomUUID } from 'node:crypto';

import type { RecommendationIntent } from './recommendation-intent.schema.js';
import type { RecommendationProduct } from './recommendation-source.schema.js';

export const RECOMMENDATION_LIMITS = {
  maxItems: 6,
  maxOutfits: 2,
  maxItemsPerOutfit: 4,
  maxSlotCandidates: 4,
  sourceTimeoutMs: 1500,
  totalBudgetMs: 4000,
} as const;

export type RecommendationProfileSignals = {
  preferredStyles?: string[];
  avoidedStyles?: string[];
  preferredOccasions?: string[];
  silhouetteSignals?: string[];
  priceSensitivity?: 'low' | 'medium' | 'high' | null;
};

export function createRecommendationRef(): string {
  return randomUUID();
}

export function sortProducts(
  products: RecommendationProduct[],
  intent: RecommendationIntent,
  profile?: RecommendationProfileSignals,
): RecommendationProduct[] {
  const styleSet = new Set(intent.styles ?? []);
  const preferredStyles = new Set(profile?.preferredStyles ?? []);
  const avoidedStyles = new Set(profile?.avoidedStyles ?? []);
  const preferredOccasions = new Set(profile?.preferredOccasions ?? []);
  const preferredFits = new Set(profile?.silhouetteSignals ?? []);

  return [...products].sort((left, right) => {
    const score = (product: RecommendationProduct) => {
      let value = 0;
      if (intent.inStock && product.inStock === true) value += 100;
      if (product.inStock === false) value -= 100;
      value += product.verifiedReasons.length * 5;
      if (
        styleSet.size > 0 &&
        product.styles.some((item) => styleSet.has(item))
      )
        value += 20;
      if (
        preferredStyles.size > 0 &&
        product.styles.some((item) => preferredStyles.has(item))
      )
        value += 10;
      if (avoidedStyles.size > 0) {
        value -=
          product.styles.filter((item) => avoidedStyles.has(item)).length * 12;
      }
      if (
        preferredOccasions.size > 0 &&
        product.occasions.some((item) => preferredOccasions.has(item))
      )
        value += 8;
      if (
        preferredFits.size > 0 &&
        product.fits.some((item) => preferredFits.has(item))
      )
        value += 6;
      if (profile?.priceSensitivity === 'high' && product.price)
        value -= Math.min(100, Number(product.price) / 10);
      if (profile?.priceSensitivity === 'low' && product.price)
        value += Math.min(20, Number(product.price) / 100);
      return value;
    };
    const scoreDelta = score(right) - score(left);
    if (scoreDelta !== 0) return scoreDelta;
    const nameDelta = left.name.localeCompare(right.name, 'zh-CN');
    if (nameDelta !== 0) return nameDelta;
    return `${left.sourceId}:${left.sourceProductRef}`.localeCompare(
      `${right.sourceId}:${right.sourceProductRef}`,
    );
  });
}
