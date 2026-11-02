import { z } from 'zod';

export const memoryCategorySchema = z.enum([
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

export type MemoryCategory = z.infer<typeof memoryCategorySchema>;
export type MemoryValueType = 'single' | 'multi' | 'range';

const shortText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u001f]/u.test(value));

const sizeValueSchema = z.strictObject({
  category: z.literal('size'),
  value: z.strictObject({
    garment: z.enum(['top', 'bottom', 'dress', 'outerwear', 'unknown']),
    label: shortText(32),
    system: z.enum(['CN', 'US', 'EU', 'UK', 'INT', 'OTHER']).optional(),
  }),
});

const shoeSizeValueSchema = z.strictObject({
  category: z.literal('shoe_size'),
  value: z.strictObject({
    value: z.number().min(20).max(60),
    system: z.enum(['CN', 'US', 'EU', 'UK']),
    width: z.enum(['narrow', 'regular', 'wide']).optional(),
  }),
});

const fitValueSchema = z.strictObject({
  category: z.literal('fit'),
  value: z.strictObject({
    preference: z.enum(['loose', 'regular', 'slim']),
    notes: z.string().trim().max(80).optional(),
  }),
});

const styleValueSchema = z.strictObject({
  category: z.literal('style'),
  value: z.strictObject({
    items: z
      .array(
        z.enum([
          'minimal',
          'commute',
          'street',
          'casual',
          'formal',
          'sporty',
          'vintage',
          'outdoor',
          'other',
        ]),
      )
      .min(1)
      .max(5),
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
    items: z
      .array(
        z.enum([
          'commute',
          'casual',
          'formal',
          'outdoor',
          'travel',
          'sport',
          'home',
          'party',
          'other',
        ]),
      )
      .min(1)
      .max(5),
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
    items: z
      .array(
        z.enum([
          'quality',
          'price',
          'easy_care',
          'sustainable',
          'online',
          'offline',
          'durable',
          'other',
        ]),
      )
      .min(1)
      .max(6),
  }),
});

export const memoryValueByCategorySchema = z.discriminatedUnion('category', [
  sizeValueSchema,
  shoeSizeValueSchema,
  fitValueSchema,
  styleValueSchema,
  colorValueSchema,
  occasionValueSchema,
  budgetValueSchema,
  avoidanceValueSchema,
  purchasePreferenceValueSchema,
]);

export type MemoryValue = z.infer<typeof memoryValueByCategorySchema>['value'];

export function getMemoryValueType(category: MemoryCategory): MemoryValueType {
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

export function parseMemoryValue(
  category: MemoryCategory,
  value: unknown,
): MemoryValue {
  return memoryValueByCategorySchema.parse({ category, value }).value;
}
