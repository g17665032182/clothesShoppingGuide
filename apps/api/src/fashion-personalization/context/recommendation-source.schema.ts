import { z } from 'zod';

import { normalizeProductPublicUrl } from '../../product-catalog/index.js';
import { recommendationCategorySchema } from './recommendation-intent.schema.js';

export const recommendationSourceTypeSchema = z.enum([
  'local_catalog',
  'online_api',
  'mcp',
]);

const publicUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => normalizeProductPublicUrl(value) !== null,
    '商品链接必须是外部公开 HTTP/HTTPS 地址',
  )
  .max(2048);

const observedAtSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) <= Date.now() + 60_000, {
    message: '商品观测时间不能明显晚于当前时间',
  });

export const recommendationProductSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(80),
  sourceType: recommendationSourceTypeSchema,
  sourceProductRef: z.string().trim().min(1).max(160),
  sourceSkuRef: z.string().trim().min(1).max(160).nullable(),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(100).nullable(),
  category: recommendationCategorySchema,
  imageUrl: publicUrlSchema.nullable(),
  productUrl: publicUrlSchema.nullable(),
  price: z
    .string()
    .regex(/^\d{1,10}\.\d{2}$/u)
    .nullable(),
  currency: z.string().length(3).nullable(),
  inStock: z.boolean().nullable(),
  styles: z.array(z.string().trim().min(1).max(32)).max(10),
  occasions: z.array(z.string().trim().min(1).max(32)).max(10),
  colors: z.array(z.string().trim().min(1).max(32)).max(100),
  fits: z.array(z.string().trim().min(1).max(32)).max(10),
  observedAt: observedAtSchema,
  verifiedReasons: z.array(z.string().trim().min(1).max(80)).max(12),
});

export type RecommendationProduct = z.output<
  typeof recommendationProductSchema
>;

export const recommendationSourceSearchInputSchema = z.strictObject({
  intent: z.unknown(),
  slot: recommendationCategorySchema,
  limit: z.number().int().min(1).max(4),
  timeoutMs: z.number().int().min(1).max(1500),
  requestRef: z.string().uuid(),
});

export type RecommendationSourceSearchInput = {
  intent: import('./recommendation-intent.schema.js').RecommendationIntent;
  slot: z.infer<typeof recommendationCategorySchema>;
  limit: number;
  timeoutMs: number;
  requestRef: string;
};

export const recommendationSourceSearchResultSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(80),
  sourceType: recommendationSourceTypeSchema,
  items: z.array(recommendationProductSchema).max(4),
  noResultReason: z
    .enum([
      'NO_MATCHING_SIZE',
      'OVER_BUDGET',
      'OUT_OF_STOCK',
      'NO_MATCHING_PRODUCT',
      'SOURCE_UNAVAILABLE',
    ])
    .nullable(),
  observedAt: observedAtSchema,
});

export type RecommendationSourceSearchResult = z.output<
  typeof recommendationSourceSearchResultSchema
>;
