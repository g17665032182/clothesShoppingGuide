import { Injectable } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import type { ProductCatalogImport } from '../import/product-catalog-import.schema.js';
import { Product } from '../entity/product.entity.js';
import { ProductSku } from '../entity/product-sku.entity.js';

export type ProductCatalogImportResult = {
  created: number;
  updated: number;
  skuCount: number;
};

@Injectable()
export class ProductCatalogImportService {
  public async upsertInTransaction(
    entityManager: EntityManager,
    products: ProductCatalogImport['products'],
  ): Promise<ProductCatalogImportResult> {
    let created = 0;
    let updated = 0;

    for (const input of products) {
      const existing = await entityManager.findOne(Product, {
        externalId: input.externalId,
      });
      const product = await entityManager.upsert(
        Product,
        {
          // 原生 upsert 不会触发 Entity 字段初始化，新增记录必须显式生成主键。
          id: existing?.id ?? randomUUID(),
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
          // 试穿开关由管理员维护，导入默认值不得覆盖已有设置。
          onConflictExcludeFields: ['id', 'createdAt', 'tryOnEnabled'],
        },
      );
      existing ? updated++ : created++;

      for (const sku of input.skus) {
        const existingSku = await entityManager.findOne(ProductSku, {
          productId: product.id,
          externalSkuId: sku.externalSkuId,
        });
        await entityManager.upsert(
          ProductSku,
          {
            id: existingSku?.id ?? randomUUID(),
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

    await entityManager.flush();
    return {
      created,
      updated,
      skuCount: products.reduce((sum, product) => sum + product.skus.length, 0),
    };
  }
}
