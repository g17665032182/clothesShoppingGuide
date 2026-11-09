import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityManager } from '@mikro-orm/core';
import type { EntityRepository } from '@mikro-orm/postgresql';

import { Product } from '../entity/product.entity.js';
import {
  type ProductCatalogTryOnPort,
  type TryOnProductProjection,
} from '../port/product-catalog-try-on.port.js';
import { normalizeProductPublicUrl } from '../public-url.js';

type TryOnProductRow = {
  product_external_id: string;
  product_name: string;
  category: string;
  try_on_enabled: boolean;
  try_on_image_key: string | null;
  color: string | null;
  image_url: string | null;
};

const TRY_ON_CATEGORIES = new Set(['tops', 'bottoms', 'dresses', 'outerwear']);

/**
 * 为试穿模块提供商品事实投影，避免跨模块读取商品 Entity。
 */
@Injectable()
export class ProductCatalogTryOnService implements ProductCatalogTryOnPort {
  public constructor(
    @InjectRepository(Product)
    private readonly products: EntityRepository<Product>,
  ) {}

  public async getTryOnProduct(
    productExternalId: string,
    manager?: EntityManager,
  ): Promise<TryOnProductProjection | null> {
    return (
      (await this.getTryOnProducts([productExternalId], manager)).get(
        productExternalId,
      ) ?? null
    );
  }

  public async getTryOnProducts(
    productExternalIds: string[],
    manager: EntityManager = this.products.getEntityManager(),
  ): Promise<Map<string, TryOnProductProjection>> {
    const ids = [...new Set(productExternalIds)];
    if (ids.length > 200) throw new BadRequestException('商品批量查询超过上限');
    const result = new Map<string, TryOnProductProjection>();
    if (ids.length === 0) return result;
    const rows = await manager.getConnection().execute<TryOnProductRow[]>(
      `select p.external_id as product_external_id, p.name as product_name,
                p.category, p.try_on_enabled, p.try_on_image_key, s.color, s.image_url
           from products p
           left join product_skus s
             on s.product_id = p.id and s.is_active = true and s.currency = 'CNY'
          where p.external_id in (${ids.map(() => '?').join(',')})
            and p.is_active = true
          order by p.external_id asc, s.id asc`,
      ids,
      'all',
      manager.getTransactionContext(),
    );

    for (const row of rows) {
      let product = result.get(row.product_external_id);
      if (!product) {
        product = {
          productExternalId: row.product_external_id,
          productName: row.product_name,
          category: row.category as TryOnProductProjection['category'],
          tryOnEnabled: row.try_on_enabled,
          tryOnEligible: false,
          tryOnImageObjectKey: row.try_on_image_key ?? null,
          mainImageUrl: null,
          colors: [],
        };
        result.set(row.product_external_id, product);
      }
      const imageUrl = normalizeProductPublicUrl(row.image_url);
      product.mainImageUrl ??= imageUrl;
      const color = row.color?.trim();
      if (!color) continue;
      const existing = product.colors.find((entry) => entry.color === color);
      if (!existing) {
        product.colors.push({ color, imageUrl });
      } else if (!existing.imageUrl && imageUrl) {
        existing.imageUrl = imageUrl;
      }
    }

    for (const product of result.values()) {
      // 资格不依赖库存、搜索筛选或管理员开关，所有消费方共享同一事实。
      product.tryOnEligible =
        TRY_ON_CATEGORIES.has(product.category) &&
        product.colors.some(
          (color) => color.imageUrl || product.tryOnImageObjectKey,
        );
    }
    return result;
  }
}
