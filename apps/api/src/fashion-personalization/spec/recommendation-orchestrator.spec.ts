import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendationIntentSchema } from '../context/recommendation-intent.schema.js';
import type {
  RecommendationProduct,
  RecommendationSourceSearchInput,
  RecommendationSourceSearchResult,
} from '../context/recommendation-source.schema.js';
import { OutfitComposerService } from '../service/outfit-composer.service.js';
import { RecommendationOrchestratorService } from '../service/recommendation-orchestrator.service.js';
import { RecommendationSourceRegistryService } from '../service/recommendation-source-registry.service.js';
import type { RecommendationProductSource } from '../port/recommendation-product-source.port.js';

const sourceProduct = (
  category: RecommendationProduct['category'],
  id: string,
): RecommendationProduct => ({
  sourceId: 'local_catalog',
  sourceType: 'local_catalog',
  sourceProductRef: id,
  sourceSkuRef: null,
  name: id,
  brand: null,
  category,
  imageUrl: null,
  productUrl: null,
  price: '100.00',
  currency: 'CNY',
  inStock: true,
  styles: [],
  occasions: [],
  colors: ['黑色'],
  fits: [],
  observedAt: new Date().toISOString(),
  verifiedReasons: ['stock_available'],
});

test('编排器限制来源投影、返回有限单品和整套目标', async () => {
  const source: RecommendationProductSource = {
    sourceId: 'local_catalog',
    sourceType: 'local_catalog',
    enabled: true,
    async search(
      input: RecommendationSourceSearchInput,
    ): Promise<RecommendationSourceSearchResult> {
      const products =
        input.slot === 'dresses'
          ? [sourceProduct('dresses', 'dress-1')]
          : input.slot === 'shoes'
            ? [sourceProduct('shoes', 'shoes-1')]
            : input.slot === 'outerwear'
              ? [sourceProduct('outerwear', 'coat-1')]
              : [];
      return {
        sourceId: 'local_catalog',
        sourceType: 'local_catalog',
        items: products,
        noResultReason: null,
        observedAt: new Date().toISOString(),
      };
    },
  };
  const registry = new RecommendationSourceRegistryService();
  const service = new RecommendationOrchestratorService(
    source,
    new OutfitComposerService(),
    registry,
  );
  const result = await service.recommend({
    intent: recommendationIntentSchema.parse({
      mode: 'both',
      category: 'dresses',
    }),
  });
  assert.equal(result.ok, true);
  assert.ok(result.targets.some((target) => target.type === 'item'));
  assert.ok(result.targets.some((target) => target.type === 'outfit'));
  assert.equal(result.targets.length <= 8, true);
});
