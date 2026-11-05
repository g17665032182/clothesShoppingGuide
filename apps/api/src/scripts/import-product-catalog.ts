import 'reflect-metadata';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { MikroORM } from '@mikro-orm/postgresql';

import config from '../mikro-orm.config.js';
import { Product } from '../product-catalog/entity/product.entity.js';
import { ProductSku } from '../product-catalog/entity/product-sku.entity.js';
import { productCatalogImportSchema } from '../product-catalog/import/product-catalog-import.schema.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArgument = args.find((argument) => !argument.startsWith('--'));
  if (!fileArgument)
    throw new Error('用法: pnpm catalog:import <file.json> [--dry-run]');
  const filePath = resolve(fileArgument);
  const file = await readFile(filePath);
  if (file.byteLength > MAX_FILE_BYTES)
    throw new Error('导入文件超过 10 MiB 上限');

  let raw: unknown;
  try {
    raw = JSON.parse(file.toString('utf8'));
  } catch {
    throw new Error('导入文件不是有效 JSON');
  }
  const parsed = productCatalogImportSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .slice(0, 50)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`商品目录校验失败:\n${errors.join('\n')}`);
  }
  const products = parsed.data.products;
  if (
    products.reduce((sum, product) => sum + product.skus.length, 0) > 500_000
  ) {
    throw new Error('商品 SKU 总数超过 500,000 上限');
  }

  if (args.includes('--dry-run')) {
    process.stdout.write(
      `${JSON.stringify({ valid: true, products: products.length, skus: products.reduce((sum, product) => sum + product.skus.length, 0) })}\n`,
    );
    return;
  }

  const orm = await MikroORM.init(config);
  try {
    const result = await orm.em.transactional(async (em) => {
      let created = 0;
      let updated = 0;
      for (const input of products) {
        const existing = await em.findOne(Product, {
          externalId: input.externalId,
        });
        const product = await em.upsert(
          Product,
          {
            externalId: input.externalId,
            name: input.name,
            brand: input.brand ?? null,
            category: input.category,
            description: input.description ?? null,
            styles: input.styles,
            occasions: input.occasions,
            fits: input.fits,
            audience: input.audience,
            productUrl: input.productUrl ?? null,
            isActive: input.isActive,
          },
          {
            onConflictFields: ['externalId'],
            onConflictExcludeFields: ['id', 'createdAt'],
          },
        );
        existing ? updated++ : created++;
        for (const sku of input.skus) {
          await em.upsert(
            ProductSku,
            {
              productId: product.id,
              externalSkuId: sku.externalSkuId,
              color: sku.color,
              size: sku.size,
              price: sku.price.toFixed(2),
              currency: 'CNY',
              stock: sku.stock,
              imageUrl: sku.imageUrl ?? null,
              isActive: sku.isActive,
            },
            {
              onConflictFields: ['productId', 'externalSkuId'],
              onConflictExcludeFields: ['id', 'createdAt'],
            },
          );
        }
      }
      await em.flush();
      return {
        created,
        updated,
        skuCount: products.reduce(
          (sum, product) => sum + product.skus.length,
          0,
        ),
      };
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '商品目录导入失败';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
