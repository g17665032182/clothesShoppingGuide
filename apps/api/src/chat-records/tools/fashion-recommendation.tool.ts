import { tool, type StructuredToolInterface } from '@langchain/core/tools';

import {
  recommendationIntentSchema,
  type RecommendationIntent,
} from '../../fashion-personalization/context/recommendation-intent.schema.js';
import type {
  RecommendationItemTarget,
  RecommendationOutfitTarget,
} from '../../fashion-personalization/context/recommendation-target.schema.js';
import type { RecommendationProduct } from '../../fashion-personalization/context/recommendation-source.schema.js';
import type { RecommendationResult } from '../../fashion-personalization/service/recommendation-orchestrator.service.js';
import type { RecommendationRequestScope } from '../../fashion-personalization/service/recommendation-source-registry.service.js';
import type { FashionRecommendationPort } from '../../fashion-personalization/port/fashion-recommendation.port.js';
import {
  fashionRecommendationCardSchema,
  type FashionRecommendationCard,
} from '../display/fashion-recommendation-card.js';

const SOURCE_NAMES: Record<string, string> = {
  local_catalog: '本地商品目录',
  pinduoduo: '拼多多',
  taobao: '淘宝',
};

export function createFashionRecommendationTool(
  recommendation: FashionRecommendationPort,
  scope: RecommendationRequestScope,
  profile: Awaited<ReturnType<FashionRecommendationPort['getProfileSignals']>>,
  onCard: (
    card: FashionRecommendationCard,
    intent: RecommendationIntent,
  ) => void,
  onRequested?: () => void,
): StructuredToolInterface {
  let hasRecommendedThisTurn = false;
  return tool(
    async (input) => {
      if (hasRecommendedThisTurn) {
        return JSON.stringify({
          ok: false,
          code: 'recommendation_already_called',
        });
      }
      hasRecommendedThisTurn = true;
      const parsed = recommendationIntentSchema.safeParse(input);
      if (!parsed.success) {
        return JSON.stringify({ ok: false, code: 'invalid_intent' });
      }
      onRequested?.();
      const result = await recommendation.recommend({
        intent: parsed.data,
        scope,
        profile,
      });
      if (!result.ok) {
        return JSON.stringify({
          ok: false,
          code:
            result.sourceStatus === 'unavailable'
              ? 'source_unavailable'
              : 'no_matching_product',
          incompleteSlots: result.incompleteSlots,
        });
      }
      const card = createCard(scope, parsed.data, result);
      onCard(card, parsed.data);
      return JSON.stringify({
        ok: true,
        recommendationId: scope.recommendationId,
        requestRef: scope.requestRef,
        card,
        incompleteSlots: result.incompleteSlots,
        sourceStatus: result.sourceStatus,
      });
    },
    {
      name: 'search_fashion_recommendations',
      description:
        '根据用户明确的场合、风格、预算、尺码和颜色搜索单品或整套穿搭。商品价格、库存、图片和链接只能使用工具返回的已验证商品事实，不得自行编造；首期商品来自本地商品目录。',
      schema: recommendationIntentSchema,
    },
  );
}

function createCard(
  scope: RecommendationRequestScope,
  intent: RecommendationIntent,
  result: RecommendationResult,
): FashionRecommendationCard {
  const items = result.targets
    .filter(
      (target): target is { type: 'item'; target: RecommendationItemTarget } =>
        target.type === 'item',
    )
    .map((target) =>
      toCardItem(target.target.targetRef, target.target.product),
    );
  const outfits = result.targets
    .filter(
      (
        target,
      ): target is {
        type: 'outfit';
        target: RecommendationOutfitTarget;
      } => target.type === 'outfit',
    )
    .map((target) => ({
      outfitRef: target.target.targetRef,
      styleSummary: target.target.styleSummary,
      items: target.target.items.map((item) => ({
        slot: item.slot,
        targetRef: item.targetRef,
        item: toCardItem(item.targetRef, item.product),
      })),
      total: target.target.total,
      missingSlots: target.target.missingSlots,
    }));
  const card = {
    type: 'card' as const,
    name: 'outfit_recommendation' as const,
    data: {
      version: 1 as const,
      recommendationId: scope.recommendationId,
      mode: intent.mode,
      styleSummary: createStyleSummary(intent, result),
      items,
      outfits,
    },
  };
  const parsed = fashionRecommendationCardSchema.safeParse(card);
  if (!parsed.success) throw new Error('推荐卡片投影不符合安全协议');
  return parsed.data;
}

function toCardItem(
  targetRef: string,
  product: RecommendationProduct,
): FashionRecommendationCard['data']['items'][number] {
  return {
    targetRef,
    sourceId: product.sourceId,
    sourceType: product.sourceType,
    sourceName: SOURCE_NAMES[product.sourceId] ?? product.sourceId,
    externalId: product.sourceProductRef,
    slot: product.category,
    name: product.name,
    brand: product.brand,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    price: product.price,
    currency: product.currency === 'CNY' ? 'CNY' : null,
    inStock: product.inStock === true,
    observedAt: product.observedAt,
    matchReasons: product.verifiedReasons.slice(0, 9),
  };
}

function createStyleSummary(
  intent: RecommendationIntent,
  result: RecommendationResult,
): string {
  if (intent.styles?.length) return `偏${intent.styles.join('、')}风格`;
  if (intent.occasion) return `适合${intent.occasion}场合`;
  return result.targets.some((target) => target.type === 'outfit')
    ? '按当前需求组合的整套穿搭'
    : '按当前需求筛选的单品';
}
