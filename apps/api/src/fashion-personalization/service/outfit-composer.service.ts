import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { RecommendationIntent } from '../context/recommendation-intent.schema.js';
import type { RecommendationProduct } from '../context/recommendation-source.schema.js';
import type { RecommendationOutfitTarget } from '../context/recommendation-target.schema.js';

export type OutfitTemplate =
  | 'dress_shoes_outerwear'
  | 'tops_bottoms_shoes_outerwear';

type TemplateDefinition = {
  id: OutfitTemplate;
  requiredSlots: Array<RecommendationProduct['category']>;
  optionalSlots: Array<RecommendationProduct['category']>;
};

const templates: TemplateDefinition[] = [
  {
    id: 'dress_shoes_outerwear',
    requiredSlots: ['dresses', 'shoes'],
    optionalSlots: ['outerwear'],
  },
  {
    id: 'tops_bottoms_shoes_outerwear',
    requiredSlots: ['tops', 'bottoms', 'shoes'],
    optionalSlots: ['outerwear'],
  },
];

@Injectable()
export class OutfitComposerService {
  public compose(
    candidates: Map<RecommendationProduct['category'], RecommendationProduct[]>,
    intent: RecommendationIntent,
    limit = 2,
  ): RecommendationOutfitTarget[] {
    const template = this.selectTemplate(intent, candidates);
    const allSlots = [...template.requiredSlots, ...template.optionalSlots];
    const missingSlots = allSlots.filter(
      (slot) => (candidates.get(slot)?.length ?? 0) === 0,
    );
    const availableSlots = allSlots.filter(
      (slot) => (candidates.get(slot)?.length ?? 0) > 0,
    );
    if (
      template.requiredSlots.filter(
        (slot) => (candidates.get(slot)?.length ?? 0) === 0,
      ).length > Math.max(0, template.requiredSlots.length - 2)
    ) {
      return [];
    }

    const combinations = combineSlots(
      availableSlots,
      candidates,
      intent,
      Math.max(limit * 8, 8),
    );
    return combinations
      .filter((items) => items.length >= 2 && items.length <= 4)
      .map((items) => ({
        targetRef: randomUUID(),
        template: template.id,
        styleSummary: createStyleSummary(intent, items),
        items: items.map(({ slot, product }) => ({
          slot,
          targetRef: randomUUID(),
          product,
        })),
        total: calculateTotal(items.map(({ product }) => product)),
        missingSlots,
      }))
      .slice(0, Math.min(limit, 2));
  }

  private selectTemplate(
    intent: RecommendationIntent,
    candidates: Map<RecommendationProduct['category'], RecommendationProduct[]>,
  ): TemplateDefinition {
    if (intent.category === 'dresses') return templates[0]!;
    if (
      intent.requestedSlots?.includes('dresses') &&
      !intent.requestedSlots.includes('tops')
    )
      return templates[0]!;
    if (intent.requestedSlots?.includes('tops')) return templates[1]!;
    if (intent.requestedSlots?.includes('bottoms')) return templates[1]!;
    if ((candidates.get('dresses')?.length ?? 0) > 0) return templates[0]!;
    return templates[1]!;
  }
}

function combineSlots(
  slots: Array<RecommendationProduct['category']>,
  candidates: Map<RecommendationProduct['category'], RecommendationProduct[]>,
  intent: RecommendationIntent,
  maxCombinations: number,
): Array<
  Array<{
    slot: RecommendationProduct['category'];
    product: RecommendationProduct;
  }>
> {
  const result: Array<
    Array<{
      slot: RecommendationProduct['category'];
      product: RecommendationProduct;
    }>
  > = [];
  const visit = (
    index: number,
    current: Array<{
      slot: RecommendationProduct['category'];
      product: RecommendationProduct;
    }>,
    amount: number,
  ) => {
    if (result.length >= maxCombinations) return;
    if (index >= slots.length) {
      if (withinBudget(amount, intent)) result.push(current);
      return;
    }
    const slot = slots[index]!;
    const items = (candidates.get(slot) ?? []).slice(0, 4);
    if (items.length === 0) {
      visit(index + 1, current, amount);
      return;
    }
    for (const product of items) {
      if (product.inStock === false) continue;
      const price = product.price === null ? 0 : Number(product.price);
      const nextAmount = amount + price;
      if (intent.budgetMax !== undefined && nextAmount > intent.budgetMax)
        continue;
      visit(index + 1, [...current, { slot, product }], nextAmount);
      if (result.length >= maxCombinations) return;
    }
  };
  visit(0, [], 0);
  return result;
}

function withinBudget(amount: number, intent: RecommendationIntent): boolean {
  if (intent.budgetMin !== undefined && amount < intent.budgetMin) return false;
  return intent.budgetMax === undefined || amount <= intent.budgetMax;
}

function calculateTotal(
  products: RecommendationProduct[],
): RecommendationOutfitTarget['total'] {
  if (
    products.some(
      (product) =>
        product.price === null ||
        product.currency !== 'CNY' ||
        product.inStock === null,
    )
  )
    return null;
  const amount = products.reduce(
    (total, product) => total + Number(product.price),
    0,
  );
  return { amount: amount.toFixed(2), currency: 'CNY' };
}

function createStyleSummary(
  intent: RecommendationIntent,
  items: Array<{
    slot: RecommendationProduct['category'];
    product: RecommendationProduct;
  }>,
): string {
  const labels = [...new Set(items.flatMap(({ product }) => product.styles))];
  const style = intent.styles?.[0] ?? labels[0];
  return style
    ? `按${style}方向组合，商品属性来自已验证目录。`
    : '按当前场合与商品标签组合，商品属性来自已验证目录。';
}
