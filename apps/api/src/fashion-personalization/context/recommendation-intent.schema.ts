import { z } from 'zod';

export const recommendationCategorySchema = z.enum([
  'tops',
  'bottoms',
  'dresses',
  'outerwear',
  'shoes',
]);

export const recommendationModeSchema = z.enum(['item', 'outfit', 'both']);

const uniqueStrings = (value: string[]) => new Set(value).size === value.length;

export const recommendationIntentSchema = z
  .strictObject({
    mode: recommendationModeSchema.default('both'),
    styles: z
      .array(z.string().trim().min(1).max(32))
      .max(3)
      .refine(uniqueStrings, '风格不能重复')
      .optional(),
    occasion: z.string().trim().min(1).max(32).optional(),
    season: z.string().trim().min(1).max(32).optional(),
    category: recommendationCategorySchema.optional(),
    requestedSlots: z
      .array(recommendationCategorySchema)
      .max(5)
      .refine(uniqueStrings, '穿搭槽位不能重复')
      .optional(),
    size: z.string().trim().min(1).max(32).optional(),
    color: z.string().trim().min(1).max(32).optional(),
    fit: z.string().trim().min(1).max(32).optional(),
    budgetMin: z.number().finite().min(0).max(9_999_999_999.99).optional(),
    budgetMax: z.number().finite().min(0).max(9_999_999_999.99).optional(),
    inStock: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (
      value.budgetMin !== undefined &&
      value.budgetMax !== undefined &&
      value.budgetMin > value.budgetMax
    ) {
      context.addIssue({
        code: 'custom',
        path: ['budgetMax'],
        message: '预算上限不能低于预算下限',
      });
    }
  });

export type RecommendationIntent = z.output<typeof recommendationIntentSchema>;
export type RecommendationIntentInput = z.input<
  typeof recommendationIntentSchema
>;
