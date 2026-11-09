import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
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
  color: string | null;
  image_url: string | null;
};

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
  ): Promise<TryOnProductProjection | null> {
    const rows = await this.products
      .getEntityManager()
      .getConnection()
      .execute<TryOnProductRow[]>(
        `select p.external_id as product_external_id, p.name as product_name,
                p.category, s.color, s.image_url
           from products p
           left join product_skus s
             on s.product_id = p.id and s.is_active = true and s.currency = 'CNY'
          where p.external_id = ? and p.is_active = true
          order by s.id asc`,
        [productExternalId],
      );
    const product = rows[0];
    if (!product) return null;

    const colors: TryOnProductProjection['colors'] = [];
    const seenColors = new Set<string>();
    let mainImageUrl: string | null = null;
    for (const row of rows) {
      const imageUrl = normalizeProductPublicUrl(row.image_url);
      mainImageUrl ??= imageUrl;
      if (row.color && !seenColors.has(row.color)) {
        seenColors.add(row.color);
        colors.push({ color: row.color, imageUrl });
      } else if (row.color && imageUrl) {
        const existing = colors.find((item) => item.color === row.color);
        if (existing && !existing.imageUrl) existing.imageUrl = imageUrl;
      }
    }

    return {
      productExternalId: product.product_external_id,
      productName: product.product_name,
      category: product.category as TryOnProductProjection['category'],
      mainImageUrl,
      colors,
    };
  }
}
