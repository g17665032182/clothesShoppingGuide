import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendationIntentSchema } from '../context/recommendation-intent.schema.js';
import type { RecommendationProduct } from '../context/recommendation-source.schema.js';
import { OutfitComposerService } from '../service/outfit-composer.service.js';

const product = (
  category: RecommendationProduct['category'],
  externalId: string,
  price: string,
): RecommendationProduct => ({
  sourceId: 'local_catalog',
  sourceType: 'local_catalog',
  sourceProductRef: externalId,
  sourceSkuRef: null,
  name: externalId,
  brand: null,
  category,
  imageUrl: null,
  productUrl: null,
  price,
  currency: 'CNY',
  inStock: true,
  styles: ['复古'],
  occasions: ['约会'],
  colors: ['黑色'],
  fits: [],
  observedAt: new Date().toISOString(),
  verifiedReasons: ['style_match', 'stock_available'],
});

test('穿搭组合器生成连衣裙+鞋+外套并计算总价', () => {
  const service = new OutfitComposerService();
  const intent = recommendationIntentSchema.parse({
    mode: 'outfit',
    styles: ['复古'],
    budgetMax: 500,
  });
  const outfits = service.compose(
    new Map([
      ['dresses', [product('dresses', 'dress-1', '199.00')]],
      ['shoes', [product('shoes', 'shoes-1', '99.00')]],
      ['outerwear', [product('outerwear', 'coat-1', '199.00')]],
    ]),
    intent,
  );
  assert.equal(outfits.length, 1);
  assert.equal(outfits[0]?.items.length, 3);
  assert.equal(outfits[0]?.total?.amount, '497.00');
});

test('预算超限时不生成整套方案', () => {
  const service = new OutfitComposerService();
  const intent = recommendationIntentSchema.parse({
    mode: 'outfit',
    budgetMax: 100,
  });
  const outfits = service.compose(
    new Map([
      ['dresses', [product('dresses', 'dress-1', '199.00')]],
      ['shoes', [product('shoes', 'shoes-1', '99.00')]],
    ]),
    intent,
  );
  assert.deepEqual(outfits, []);
});
