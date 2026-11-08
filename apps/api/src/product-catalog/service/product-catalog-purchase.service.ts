import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';

import type {
  ProductCatalogPurchasePort,
  ProductCatalogPurchaseProjection,
} from '../port/product-catalog-purchase.port.js';
import { normalizeProductPublicUrl } from '../public-url.js';

type PurchaseSkuRow = {
  product_external_id: string;
  product_name: string;
  sku_id: string | null;
  color: string | null;
  size: string | null;
  unit_price: string | null;
  currency: string | null;
  in_stock: boolean | null;
  image_url: string | null;
  total_skus: string | null;
};

const maximumPurchaseSkus = 100;

@Injectable()
export class ProductCatalogPurchaseService implements ProductCatalogPurchasePort {
  public async getPurchaseSpecifications(
    em: EntityManager,
    productExternalId: string,
  ): Promise<ProductCatalogPurchaseProjection | null> {
    const transaction = em.getTransactionContext();
    if (!transaction) throw new Error('购买规格读取必须加入调用方事务');
    // 窗口计数和有界集合在同一条语句中读取，避免分页期间变动导致错误自动选择。
    const rows: PurchaseSkuRow[] = await em
      .getConnection()
      .execute<PurchaseSkuRow[]>(
        `select p.external_id as product_external_id, p.name as product_name,
         s.sku_id, s.color, s.size, s.unit_price, s.currency,
         s.in_stock, s.image_url, s.total_skus
       from products p
       left join lateral (
         select sku.id::text as sku_id, sku.color, sku.size,
           sku.price::text as unit_price, sku.currency, sku.image_url,
           (sku.stock - coalesce(r.reserved_quantity, 0)) > 0 as in_stock,
           count(*) over ()::text as total_skus
         from product_skus sku
         left join active_order_sku_reservations r on r.sku_id = sku.id
         where sku.product_id = p.id and sku.is_active = true
         order by sku.id asc
         limit ?
       ) s on true
       where p.external_id = ? and p.is_active = true
       order by s.sku_id asc`,
        [maximumPurchaseSkus + 1, productExternalId],
        'all',
        transaction,
      );
    const product = rows[0];
    if (!product) return null;
    const skuRows = rows.filter((row) => row.sku_id !== null);
    const total = Number(product.total_skus ?? 0);
    if (
      !Number.isInteger(total) ||
      total < 0 ||
      total > maximumPurchaseSkus ||
      total !== skuRows.length ||
      new Set(skuRows.map((row) => row.sku_id)).size !== total ||
      rows.some(
        (row) =>
          row.product_external_id !== productExternalId ||
          row.product_name !== product.product_name ||
          Number(row.total_skus ?? 0) !== total,
      ) ||
      (total === 0 && rows.length !== 1)
    ) {
      throw new ServiceUnavailableException('商品规格集合暂时无法完整读取');
    }
    return {
      productExternalId: product.product_external_id,
      productName: product.product_name,
      skus: skuRows.map((row) => {
        if (
          !row.sku_id ||
          row.color === null ||
          row.size === null ||
          row.unit_price === null ||
          !/^\d+\.\d{2}$/u.test(row.unit_price) ||
          row.currency !== 'CNY' ||
          typeof row.in_stock !== 'boolean'
        ) {
          throw new ServiceUnavailableException('商品规格暂时无法读取');
        }
        return {
          skuId: row.sku_id,
          productExternalId: product.product_external_id,
          productName: product.product_name,
          color: row.color,
          size: row.size,
          unitPrice: row.unit_price,
          currency: 'CNY' as const,
          inStock: row.in_stock,
          imageUrl: normalizeProductPublicUrl(row.image_url),
        };
      }),
    };
  }
}
