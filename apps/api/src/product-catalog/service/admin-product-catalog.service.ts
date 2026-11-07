import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityRepository } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';

import { Product } from '../entity/product.entity.js';
import { publicProductUrl } from '../public-url.js';
import type {
  AdminProductDetailDto,
  AdminProductPageDto,
  AdminProductSummaryDto,
  AdminProductSkuDto,
} from '../dto/admin-product-response.dto.js';
import type { AdminProductQuery } from '../dto/admin-product-query.dto.js';

type ProductSummaryRow = {
  id: string;
  external_id: string;
  name: string;
  brand: string | null;
  category: string;
  product_url: string | null;
  is_active: boolean;
  sku_count: string;
  lowest_price: string | null;
  total_stock: string;
  total_available_stock: string;
  created_at: Date;
  updated_at: Date;
};

type ProductDetailRow = ProductSummaryRow & {
  description: string | null;
  styles: string[];
  occasions: string[];
  fits: string[];
};

type ProductSkuRow = {
  id: string;
  external_sku_id: string;
  color: string;
  size: string;
  price: string;
  currency: 'CNY';
  stock: number;
  reserved_stock: string | null;
  image_url: string | null;
  is_active: boolean;
};

@Injectable()
export class AdminProductCatalogService {
  public constructor(
    @InjectRepository(Product)
    private readonly products: EntityRepository<Product>,
  ) {}

  public async list(query: AdminProductQuery): Promise<AdminProductPageDto> {
    const { where, params } = this.buildWhere(query);
    const manager = this.products.getEntityManager();
    const connection = manager.getConnection();
    // 管理员聚合全部 SKU（包括停用规格），保持实物库存和订单预占口径可核对。
    const [countRows, rows] = await Promise.all([
      connection.execute<Array<{ total: string }>>(
        `select count(*)::text as total from products p where ${where}`,
        params,
      ),
      connection.execute<ProductSummaryRow[]>(
        `select p.id::text as id, p.external_id, p.name, p.brand, p.category,
                p.product_url, p.is_active, p.created_at, p.updated_at,
                count(s.id)::text as sku_count,
                min(s.price)::text as lowest_price,
                coalesce(sum(s.stock), 0)::text as total_stock,
                coalesce(sum(s.stock - coalesce(r.reserved_quantity, 0)), 0)::text
                  as total_available_stock
         from products p
         left join product_skus s on s.product_id = p.id
         left join lateral (
           select reserved_quantity
           from active_order_sku_reservations
           where sku_id = s.id
         ) r on true
         where ${where}
         group by p.id
         order by p.updated_at desc, p.id desc
         limit ? offset ?`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize],
      ),
    ]);

    return {
      items: rows.map((row) => this.toSummary(row)),
      total: Number(countRows[0]?.total ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  public async detail(id: string): Promise<AdminProductDetailDto> {
    const manager = this.products.getEntityManager();
    const connection = manager.getConnection();
    const rows = await connection.execute<ProductDetailRow[]>(
      `select p.id::text as id, p.external_id, p.name, p.brand, p.category,
              p.product_url, p.is_active, p.description, p.styles, p.occasions,
              p.fits, p.created_at, p.updated_at,
              count(s.id)::text as sku_count,
              min(s.price)::text as lowest_price,
              coalesce(sum(s.stock), 0)::text as total_stock,
              coalesce(sum(s.stock - coalesce(r.reserved_quantity, 0)), 0)::text
                as total_available_stock
       from products p
       left join product_skus s on s.product_id = p.id
       left join lateral (
         select reserved_quantity
         from active_order_sku_reservations
         where sku_id = s.id
       ) r on true
       where p.id = ?::uuid
       group by p.id`,
      [id],
    );
    const product = rows[0];
    if (!product) throw new NotFoundException('商品不存在');

    const skuRows = await connection.execute<ProductSkuRow[]>(
      `select s.id::text as id, s.external_sku_id, s.color, s.size,
              s.price::text as price, s.currency, s.stock,
              r.reserved_quantity::text as reserved_stock,
              s.image_url, s.is_active
       from product_skus s
       left join active_order_sku_reservations r on r.sku_id = s.id
       where s.product_id = ?::uuid
       order by s.id asc`,
      [id],
    );

    return {
      ...this.toSummary(product),
      description: product.description,
      styles: product.styles ?? [],
      occasions: product.occasions ?? [],
      fits: product.fits ?? [],
      skus: skuRows.map((sku) => this.toSku(sku)),
    };
  }

  private buildWhere(query: AdminProductQuery): {
    where: string;
    params: unknown[];
  } {
    const clauses: string[] = ['true'];
    const params: unknown[] = [];
    if (query.keyword) {
      clauses.push(
        "(lower(p.name) like lower(?) escape '!' or lower(coalesce(p.brand, '')) like lower(?) escape '!' or lower(p.external_id) like lower(?) escape '!')",
      );
      // 关键字按字面子串匹配，用户输入的 SQL 通配符不扩大结果范围。
      const keyword = `%${query.keyword.replace(/[!%_]/gu, '!$&')}%`;
      params.push(keyword, keyword, keyword);
    }
    if (query.category) {
      clauses.push('p.category = ?');
      params.push(query.category);
    }
    if (query.isActive !== undefined) {
      clauses.push('p.is_active = ?');
      params.push(query.isActive);
    }
    if (query.inStock !== undefined) {
      clauses.push(
        query.inStock
          ? `exists (
               select 1
               from product_skus filter_s
               left join active_order_sku_reservations filter_r
                 on filter_r.sku_id = filter_s.id
               where filter_s.product_id = p.id
                 and filter_s.stock - coalesce(filter_r.reserved_quantity, 0) > 0
             )`
          : `not exists (
               select 1
               from product_skus filter_s
               left join active_order_sku_reservations filter_r
                 on filter_r.sku_id = filter_s.id
               where filter_s.product_id = p.id
                 and filter_s.stock - coalesce(filter_r.reserved_quantity, 0) > 0
             )`,
      );
    }
    return { where: clauses.join(' and '), params };
  }

  private toSummary(row: ProductSummaryRow): AdminProductSummaryDto {
    return {
      id: row.id,
      externalId: row.external_id,
      name: row.name,
      brand: row.brand,
      category: row.category,
      productUrl: row.product_url
        ? (publicProductUrl(row.product_url)?.toString() ?? null)
        : null,
      isActive: row.is_active,
      skuCount: Number(row.sku_count),
      lowestPrice: row.lowest_price,
      totalStock: Number(row.total_stock),
      totalAvailableStock: Number(row.total_available_stock),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private toSku(row: ProductSkuRow): AdminProductSkuDto {
    const reservedStock = Number(row.reserved_stock ?? 0);
    return {
      id: row.id,
      externalSkuId: row.external_sku_id,
      color: row.color,
      size: row.size,
      price: row.price,
      currency: row.currency,
      stock: row.stock,
      reservedStock,
      availableStock: row.stock - reservedStock,
      imageUrl: row.image_url
        ? (publicProductUrl(row.image_url)?.toString() ?? null)
        : null,
      isActive: row.is_active,
    };
  }
}
