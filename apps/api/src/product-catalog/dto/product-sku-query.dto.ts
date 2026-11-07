import { z } from 'zod';

const pageNumberSchema = z.coerce.number().int().min(1);

export const productSkuQuerySchema = z.strictObject({
  productExternalId: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
  page: pageNumberSchema.default(1),
  pageSize: pageNumberSchema.max(100).default(20),
});

export type ProductSkuQueryInput = z.input<typeof productSkuQuerySchema>;
export type ProductSkuQuery = z.output<typeof productSkuQuerySchema>;
