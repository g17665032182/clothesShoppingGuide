import { z } from 'zod';

import { recommendationCategorySchema } from './recommendation-intent.schema.js';
import { recommendationProductSchema } from './recommendation-source.schema.js';

export const recommendationItemTargetSchema = z.strictObject({
  targetRef: z.string().uuid(),
  product: recommendationProductSchema,
});

export type RecommendationItemTarget = z.output<
  typeof recommendationItemTargetSchema
>;

export const recommendationOutfitItemSchema = z.strictObject({
  slot: recommendationCategorySchema,
  targetRef: z.string().uuid(),
  product: recommendationProductSchema,
});

export type RecommendationOutfitItem = z.output<
  typeof recommendationOutfitItemSchema
>;

export const recommendationOutfitTargetSchema = z.strictObject({
  targetRef: z.string().uuid(),
  template: z.enum(['dress_shoes_outerwear', 'tops_bottoms_shoes_outerwear']),
  styleSummary: z.string().trim().min(1).max(240),
  items: z.array(recommendationOutfitItemSchema).min(2).max(4),
  total: z
    .strictObject({
      amount: z.string().regex(/^\d{1,10}\.\d{2}$/u),
      currency: z.literal('CNY'),
    })
    .nullable(),
  missingSlots: z.array(recommendationCategorySchema).max(5),
});

export type RecommendationOutfitTarget = z.output<
  typeof recommendationOutfitTargetSchema
>;

export const recommendationTargetSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('item'),
    target: recommendationItemTargetSchema,
  }),
  z.strictObject({
    type: z.literal('outfit'),
    target: recommendationOutfitTargetSchema,
  }),
]);

export type RecommendationTarget = z.output<typeof recommendationTargetSchema>;
