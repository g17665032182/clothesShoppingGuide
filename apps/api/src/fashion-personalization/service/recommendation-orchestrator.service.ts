import { Inject, Injectable } from '@nestjs/common';

import {
  RECOMMENDATION_LIMITS,
  sortProducts,
  type RecommendationProfileSignals,
} from '../context/recommendation-safety.js';
import type { RecommendationIntent } from '../context/recommendation-intent.schema.js';
import type { RecommendationProduct } from '../context/recommendation-source.schema.js';
import type {
  RecommendationTarget,
  RecommendationItemTarget,
  RecommendationOutfitTarget,
} from '../context/recommendation-target.schema.js';
import {
  RECOMMENDATION_PRODUCT_SOURCE,
  type RecommendationProductSource,
} from '../port/recommendation-product-source.port.js';
import { OutfitComposerService } from './outfit-composer.service.js';
import {
  RecommendationSourceRegistryService,
  type RecommendationRequestScope,
} from './recommendation-source-registry.service.js';

export type RecommendationResult = {
  ok: boolean;
  requestRef: string;
  targets: RecommendationTarget[];
  incompleteSlots: string[];
  sourceStatus: 'complete' | 'partial' | 'unavailable';
};

@Injectable()
export class RecommendationOrchestratorService {
  public constructor(
    @Inject(RECOMMENDATION_PRODUCT_SOURCE)
    private readonly source:
      RecommendationProductSource | RecommendationProductSource[],
    private readonly composer: OutfitComposerService,
    private readonly registry: RecommendationSourceRegistryService,
  ) {}

  public async recommend(input: {
    intent: RecommendationIntent;
    scope?: RecommendationRequestScope;
    profile?: RecommendationProfileSignals;
  }): Promise<RecommendationResult> {
    const scope = input.scope ?? this.registry.createScope();
    const startedAt = Date.now();
    const requiredSlots = this.slotsFor(input.intent);
    const sources = Array.isArray(this.source) ? this.source : [this.source];
    const enabledSources = sources.filter((source) => source.enabled);
    if (enabledSources.length === 0) {
      return {
        ok: false,
        requestRef: scope.requestRef,
        targets: [],
        incompleteSlots: requiredSlots,
        sourceStatus: 'unavailable',
      };
    }

    const collected = new Map<
      RecommendationProduct['category'],
      RecommendationProduct[]
    >();
    let hadSourceFailure = false;
    for (const slot of requiredSlots) {
      const remaining =
        RECOMMENDATION_LIMITS.totalBudgetMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        hadSourceFailure = true;
        continue;
      }
      const limit = RECOMMENDATION_LIMITS.maxSlotCandidates;
      const sourceCalls = enabledSources.map((source) =>
        this.searchSource(
          source,
          {
            intent: input.intent,
            slot,
            limit,
            timeoutMs: Math.min(
              RECOMMENDATION_LIMITS.sourceTimeoutMs,
              remaining,
            ),
            requestRef: scope.requestRef,
          },
          Math.min(RECOMMENDATION_LIMITS.sourceTimeoutMs, remaining),
        ),
      );
      const settled = await Promise.all(sourceCalls);
      const slotItems: RecommendationProduct[] = [];
      for (const result of settled) {
        if (!result) {
          hadSourceFailure = true;
          continue;
        }
        slotItems.push(...result);
      }
      collected.set(
        slot,
        uniqueProducts(
          sortProducts(
            applyHardFilters(slotItems, input.intent, slot),
            input.intent,
            input.profile,
          ),
        ).slice(0, RECOMMENDATION_LIMITS.maxSlotCandidates),
      );
    }

    const incompleteSlots = requiredSlots.filter(
      (slot) => (collected.get(slot)?.length ?? 0) === 0,
    );
    const targets: RecommendationTarget[] = [];
    if (input.intent.mode === 'item' || input.intent.mode === 'both') {
      const itemProducts = sortProducts(
        uniqueProducts([...collected.values()].flat()),
        input.intent,
        input.profile,
      ).slice(0, RECOMMENDATION_LIMITS.maxItems);
      const items = this.registry.registerProducts(scope, itemProducts);
      targets.push(...items.map(toItemTarget));
    }
    if (input.intent.mode === 'outfit' || input.intent.mode === 'both') {
      const outfits = this.composer.compose(
        collected,
        input.intent,
        RECOMMENDATION_LIMITS.maxOutfits,
      );
      const registered = this.registry.registerOutfits(scope, outfits);
      targets.push(...registered.map(toOutfitTarget));
    }

    return {
      ok: targets.length > 0,
      requestRef: scope.requestRef,
      targets,
      incompleteSlots,
      sourceStatus:
        targets.length === 0
          ? 'unavailable'
          : hadSourceFailure || incompleteSlots.length > 0
            ? 'partial'
            : 'complete',
    };
  }

  private slotsFor(
    intent: RecommendationIntent,
  ): RecommendationProduct['category'][] {
    if (intent.mode === 'item') return [intent.category ?? 'tops'];
    if (intent.requestedSlots?.length) return intent.requestedSlots;
    if (intent.category === 'dresses') return ['dresses', 'shoes', 'outerwear'];
    if (intent.category === 'tops' || intent.category === 'bottoms') {
      return ['tops', 'bottoms', 'shoes', 'outerwear'];
    }
    return ['dresses', 'tops', 'bottoms', 'shoes', 'outerwear'];
  }

  private async searchSource(
    source: RecommendationProductSource,
    input: {
      intent: RecommendationIntent;
      slot: RecommendationProduct['category'];
      limit: number;
      timeoutMs: number;
      requestRef: string;
    },
    timeoutMs: number,
  ): Promise<RecommendationProduct[] | null> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        source.search(input),
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
      if (!result) return null;
      return result.items
        .filter((product) => product.sourceId === source.sourceId)
        .filter((product) => product.sourceType === source.sourceType)
        .filter((product) => product.category === input.slot);
    } catch {
      return null;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

function applyHardFilters(
  products: RecommendationProduct[],
  intent: RecommendationIntent,
  slot: RecommendationProduct['category'],
): RecommendationProduct[] {
  return products.filter((product) => {
    if (product.category !== slot) return false;
    if (intent.inStock && product.inStock !== true) return false;
    if (product.currency !== 'CNY' || product.price === null) return false;
    const price = Number(product.price);
    if (intent.budgetMin !== undefined && price < intent.budgetMin)
      return false;
    if (intent.budgetMax !== undefined && price > intent.budgetMax)
      return false;
    if (intent.size && !product.verifiedReasons.includes('size_match'))
      return false;
    if (
      intent.color &&
      !product.colors.some(
        (color) => normalize(color) === normalize(intent.color!),
      )
    )
      return false;
    return true;
  });
}

function uniqueProducts(
  products: RecommendationProduct[],
): RecommendationProduct[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    const key = `${product.sourceId}:${product.sourceProductRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toItemTarget(target: RecommendationItemTarget): RecommendationTarget {
  return { type: 'item', target };
}

function toOutfitTarget(
  target: RecommendationOutfitTarget,
): RecommendationTarget {
  return { type: 'outfit', target };
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}
