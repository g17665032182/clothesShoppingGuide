import { z } from 'zod';

const pageSchema = z.number().int().safe().min(1).max(10);
const safeText = (maximum: number) =>
  z
    .string()
    .regex(/^[^\u0000-\u001f\u007f]*$/u)
    .trim()
    .min(1)
    .max(maximum);

export const productSkuLookupSchema = z.strictObject({
  productExternalId: safeText(160),
  color: safeText(32).optional(),
  size: safeText(32).optional(),
  page: pageSchema.default(1),
});

const productSkuLookupItemSchema = z.strictObject({
  color: safeText(32),
  size: safeText(32),
  unitPrice: z.string().regex(/^(?:0|[1-9]\d{0,9})\.\d{2}$/u),
  currency: z.literal('CNY'),
  inStock: z.boolean(),
});

const productSkuLookupPageSchema = z
  .strictObject({
    ok: z.literal(true),
    productExternalId: safeText(160),
    items: z.array(productSkuLookupItemSchema).max(5),
    page: pageSchema,
    pageSize: z.literal(5),
    total: z.number().int().safe().min(0),
    hasNext: z.boolean(),
  })
  .superRefine((result, context) => {
    const expectedLength = Math.min(
      5,
      Math.max(0, result.total - (result.page - 1) * 5),
    );
    // 计数与当前页必须一致，不能把被截断或损坏的集合当作完整结果。
    if (result.items.length !== expectedLength) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: '规格条目数与分页总数不一致',
      });
    }
    if (result.hasNext !== result.page * 5 < result.total) {
      context.addIssue({
        code: 'custom',
        path: ['hasNext'],
        message: '规格后续页标记与总数不一致',
      });
    }
  });

export const productSkuLookupResultSchema = z.discriminatedUnion('ok', [
  productSkuLookupPageSchema,
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['not_found', 'unavailable']),
  }),
]);

export type ProductSkuLookupSchemaInput = z.input<
  typeof productSkuLookupSchema
>;
export type ProductSkuLookupInput = z.output<typeof productSkuLookupSchema>;
export type ProductSkuLookupResult = z.output<
  typeof productSkuLookupResultSchema
>;
