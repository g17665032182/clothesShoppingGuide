import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { RecommendationProduct } from '../context/recommendation-source.schema.js';
import type {
  RecommendationItemTarget,
  RecommendationOutfitTarget,
} from '../context/recommendation-target.schema.js';

export type RecommendationRegistryTarget =
  | { type: 'item'; target: RecommendationItemTarget }
  | { type: 'outfit'; target: RecommendationOutfitTarget };

export type RecommendationRequestScope = {
  recommendationId: string;
  requestRef: string;
  items: RecommendationItemTarget[];
  outfits: RecommendationOutfitTarget[];
  targets: RecommendationRegistryTarget[];
};

@Injectable()
export class RecommendationSourceRegistryService {
  public createScope(): RecommendationRequestScope {
    return {
      recommendationId: randomUUID(),
      requestRef: randomUUID(),
      items: [],
      outfits: [],
      targets: [],
    };
  }

  public registerProducts(
    scope: RecommendationRequestScope,
    products: RecommendationProduct[],
  ): RecommendationItemTarget[] {
    const available = Math.max(0, 6 - scope.items.length);
    const registered = products
      .slice(0, available)
      .map((product) => ({ targetRef: randomUUID(), product }));
    scope.items.push(...registered);
    scope.targets.push(
      ...registered.map((target) => ({ type: 'item' as const, target })),
    );
    return registered;
  }

  public registerOutfits(
    scope: RecommendationRequestScope,
    outfits: RecommendationOutfitTarget[],
  ): RecommendationOutfitTarget[] {
    const available = Math.max(0, 2 - scope.outfits.length);
    const registered = outfits.slice(0, available);
    scope.outfits.push(...registered);
    scope.targets.push(
      ...registered.map((target) => ({ type: 'outfit' as const, target })),
    );
    return registered;
  }

  public getItem(
    scope: RecommendationRequestScope,
    targetRef: string,
  ): RecommendationItemTarget {
    const target = scope.items.find((item) => item.targetRef === targetRef);
    if (!target) throw new Error('推荐商品引用不存在或不属于本轮请求');
    return target;
  }

  public getOutfit(
    scope: RecommendationRequestScope,
    targetRef: string,
  ): RecommendationOutfitTarget {
    const target = scope.outfits.find((item) => item.targetRef === targetRef);
    if (!target) throw new Error('穿搭方案引用不存在或不属于本轮请求');
    return target;
  }

  public snapshot(
    scope: RecommendationRequestScope,
  ): RecommendationRequestScope {
    return structuredClone(scope);
  }
}
