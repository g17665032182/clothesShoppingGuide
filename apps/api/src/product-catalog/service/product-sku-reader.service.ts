import { IsolationLevel } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import {
  productSkuLookupResultSchema,
  productSkuLookupSchema,
  type ProductSkuLookupInput,
  type ProductSkuLookupResult,
} from '../dto/product-sku-lookup.dto.js';
import { Product } from '../entity/product.entity.js';

type ProductSkuLookupRow = {
  color: string;
  size: string;
  unit_price: string;
  currency: string;
  in_stock: boolean;
};

@Injectable()
export class ProductSkuReaderService {
  public constructor(
    @InjectRepository(Product)
    private readonly products: EntityRepository<Product>,
  ) {}

  public async listForChat(
    query: ProductSkuLookupInput,
  ): Promise<ProductSkuLookupResult> {
    const input = productSkuLookupSchema.parse(query);

    try {
      const em = this.products.getEntityManager().fork({
        clear: true,
        useContext: false,
        keepTransactionContext: false,
      });

      // 商品、总数、规格和预占量共享独立快照，不带入请求中的待写实体。
      return await em.transactional(
        async (transaction): Promise<ProductSkuLookupResult> => {
          const context = transaction.getTransactionContext();
          if (!context) throw new Error('规格查询缺少只读事务');
          const connection = transaction.getConnection();
          const products = await connection.execute<Array<{ id: string }>>(
            `select id::text as id
             from products
             where external_id = ? and is_active = true`,
            [input.productExternalId],
            'all',
            context,
          );
          const productId = products[0]?.id;
          if (!productId) return { ok: false, code: 'not_found' };

          const conditions = [
            's.product_id = ?::uuid',
            's.is_active = true',
            "s.currency = 'CNY'",
          ];
          const parameters: unknown[] = [productId];
          if (input.color !== undefined) {
            conditions.push('lower(s.color) = lower(?)');
            parameters.push(input.color);
          }
          if (input.size !== undefined) {
            conditions.push('lower(s.size) = lower(?)');
            parameters.push(input.size);
          }
          const where = conditions.join(' and ');
          const counts = await connection.execute<Array<{ total: string }>>(
            `select count(*)::text as total
             from product_skus s
             where ${where}`,
            parameters,
            'all',
            context,
          );
          const rawTotal = counts[0]?.total;
          if (typeof rawTotal !== 'string' || !/^\d+$/u.test(rawTotal)) {
            throw new Error('规格计数无效');
          }
          const total = Number(rawTotal);
          if (!Number.isSafeInteger(total)) throw new Error('规格计数越界');

          // 过滤完整集合后分页；不套用购买规格的固定全量读取上限。
          const rows = await connection.execute<ProductSkuLookupRow[]>(
            `select s.color, s.size, s.price::text as unit_price, s.currency,
                    (s.stock - coalesce(r.reserved_quantity, 0)) > 0 as in_stock
             from product_skus s
             left join active_order_sku_reservations r on r.sku_id = s.id
             where ${where}
             order by s.id asc
             limit ? offset ?`,
            [...parameters, 5, (input.page - 1) * 5],
            'all',
            context,
          );

          return productSkuLookupResultSchema.parse({
            ok: true,
            productExternalId: input.productExternalId,
            items: rows.map((row) => ({
              color: row.color,
              size: row.size,
              unitPrice: row.unit_price,
              currency: row.currency,
              inStock: row.in_stock,
            })),
            page: input.page,
            pageSize: 5,
            total,
            hasNext: input.page * 5 < total,
          });
        },
        { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true },
      );
    } catch {
      // 依赖故障和损坏数据统一失败，避免回传数据库或校验异常原文。
      return { ok: false, code: 'unavailable' };
    }
  }
}
