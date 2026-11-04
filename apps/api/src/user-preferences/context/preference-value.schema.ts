import { z } from 'zod';

export const preferenceCategorySchema = z.enum([
  'size',
  'shoe_size',
  'fit',
  'style',
  'color',
  'occasion',
  'budget',
  'avoidance',
  'purchase_preference',
]);

export type PreferenceCategory = z.infer<typeof preferenceCategorySchema>;
export type PreferenceValueType = 'single' | 'multi' | 'range';

const shortText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u001f]/u.test(value));

// 预设代码与自定义短文本共用结构，保留旧记录及模型候选的兼容性。
const sizeValueSchema = z.strictObject({
  category: z.literal('size'),
  value: z.strictObject({
    garment: shortText(32),
    label: shortText(32),
    system: shortText(32).optional(),
  }),
});

const shoeSizeValueSchema = z.strictObject({
  category: z.literal('shoe_size'),
  value: z.strictObject({
    value: z.number().min(20).max(60),
    system: shortText(32),
    width: shortText(32).optional(),
  }),
});

const fitValueSchema = z.strictObject({
  category: z.literal('fit'),
  value: z.strictObject({
    preference: shortText(32),
    notes: z.string().trim().max(80).optional(),
  }),
});

const styleValueSchema = z.strictObject({
  category: z.literal('style'),
  value: z.strictObject({
    items: z.array(shortText(32)).min(1).max(5),
  }),
});

const colorValueSchema = z.strictObject({
  category: z.literal('color'),
  value: z.strictObject({
    mode: z.enum(['prefer', 'avoid']),
    items: z.array(shortText(32)).min(1).max(8),
  }),
});

const occasionValueSchema = z.strictObject({
  category: z.literal('occasion'),
  value: z.strictObject({
    items: z.array(shortText(32)).min(1).max(5),
  }),
});

const budgetValueSchema = z.strictObject({
  category: z.literal('budget'),
  value: z
    .strictObject({
      currency: z.enum(['CNY', 'USD']),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .refine(({ min, max }) => min !== undefined || max !== undefined)
    .refine(
      ({ min, max }) => min === undefined || max === undefined || min <= max,
    ),
});

const avoidanceValueSchema = z.strictObject({
  category: z.literal('avoidance'),
  value: z.strictObject({
    terms: z.array(shortText(32)).min(1).max(8),
    reason: z.string().trim().max(80).optional(),
  }),
});

const purchasePreferenceValueSchema = z.strictObject({
  category: z.literal('purchase_preference'),
  value: z.strictObject({
    items: z.array(shortText(32)).min(1).max(6),
  }),
});

export const preferenceValueByCategorySchema = z.discriminatedUnion(
  'category',
  [
    sizeValueSchema,
    shoeSizeValueSchema,
    fitValueSchema,
    styleValueSchema,
    colorValueSchema,
    occasionValueSchema,
    budgetValueSchema,
    avoidanceValueSchema,
    purchasePreferenceValueSchema,
  ],
);

export type PreferenceValue = z.infer<
  typeof preferenceValueByCategorySchema
>['value'];

export function getPreferenceValueType(
  category: PreferenceCategory,
): PreferenceValueType {
  switch (category) {
    case 'size':
    case 'shoe_size':
    case 'fit':
      return 'single';
    case 'budget':
      return 'range';
    default:
      return 'multi';
  }
}

export function parsePreferenceValue(
  category: PreferenceCategory,
  value: unknown,
): PreferenceValue {
  return preferenceValueByCategorySchema.parse({ category, value }).value;
}
