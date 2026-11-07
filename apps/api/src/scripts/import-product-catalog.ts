import 'reflect-metadata';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { productCatalogImportSchema } from '../product-catalog/index.js';
import { OrderCatalogImportService } from '../order-catalog-coordination/service/order-catalog-import.service.js';

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

  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const importer = application.get(OrderCatalogImportService);
    const result = await importer.import(products);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await application.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '商品目录导入失败';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
