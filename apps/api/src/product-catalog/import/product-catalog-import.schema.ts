import { z } from 'zod';

import { publicProductUrl } from '../public-url.js';

const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));

const publicUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
  .nullable()
  .optional()
  .refine((value) => value == null || publicProductUrl(value) !== null, {
    message: 'URL 必须指向公网地址',
  });

const skuSchema = z.strictObject({
  externalSkuId: safeText(160),
  color: safeText(32),
  size: safeText(32),
  price: z.number().finite().min(0).max(9_999_999_999.99),
  stock: z.number().int().min(0).max(2_147_483_647),
  imageUrl: publicUrl,
  isActive: z.boolean().default(true),
});

export const productCatalogImportSchema = z
  .strictObject({
    version: z.literal(1),
    products: z
      .array(
        z.strictObject({
          externalId: safeText(160),
          name: safeText(200),
          brand: safeText(100).nullable().optional(),
          category: z.enum([
            'tops',
            'bottoms',
            'dresses',
            'outerwear',
            'shoes',
          ]),
          description: z.string().trim().max(2000).nullable().optional(),
          styles: z.array(safeText(32)).max(10).default([]),
          occasions: z.array(safeText(32)).max(10).default([]),
          fits: z.array(safeText(32)).max(10).default([]),
          audience: z.literal('adult').default('adult'),
          productUrl: publicUrl,
          isActive: z.boolean().default(true),
          skus: z.array(skuSchema).min(1).max(100),
        }),
      )
      .min(1)
      .max(5000),
  })
  .superRefine((catalog, context) => {
    const products = new Set<string>();
    catalog.products.forEach((product, productIndex) => {
      if (products.has(product.externalId)) {
        context.addIssue({
          code: 'custom',
          path: ['products', productIndex, 'externalId'],
          message: 'externalId 重复',
        });
      }
      products.add(product.externalId);
      const skus = new Set<string>();
      product.skus.forEach((sku, skuIndex) => {
        if (skus.has(sku.externalSkuId)) {
          context.addIssue({
            code: 'custom',
            path: ['products', productIndex, 'skus', skuIndex, 'externalSkuId'],
            message: 'externalSkuId 重复',
          });
        }
        skus.add(sku.externalSkuId);
      });
    });
  });

export type ProductCatalogImport = z.output<typeof productCatalogImportSchema>;
