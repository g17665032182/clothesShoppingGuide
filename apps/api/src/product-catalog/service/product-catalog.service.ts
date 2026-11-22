import { createHmac, timingSafeEqual } from 'node:crypto';

import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityManager } from '@mikro-orm/core';
import type { EntityRepository } from '@mikro-orm/postgresql';
import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import { Product } from '../entity/product.entity.js';
import { publicProductUrl } from '../public-url.js';
import {
  type ProductSkuPageResponse,
  type ProductSkuResponse,
} from '../dto/product-sku-response.dto.js';
import type { ProductSkuQuery } from '../dto/product-sku-query.dto.js';
import { ProductCatalogTryOnService } from './product-catalog-try-on.service.js';

export const productSearchSchema = z.strictObject({
  category: z
    .enum(['tops', 'bottoms', 'dresses', 'outerwear', 'shoes'])
    .optional(),
  size: z.string().trim().min(1).max(32).optional(),
  color: z.string().trim().min(1).max(32).optional(),
  style: z.string().trim().min(1).max(32).optional(),
  occasion: z.string().trim().min(1).max(32).optional(),
  fit: z.string().trim().min(1).max(32).optional(),
  budgetMin: z.number().finite().min(0).max(9_999_999_999.99).optional(),
  budgetMax: z.number().finite().min(0).max(9_999_999_999.99).optional(),
  inStock: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).default(3),
  cursor: z.string().max(4096).optional(),
});

export type ProductSearchInput = z.output<typeof productSearchSchema>;
export const productSearchToolSchema = productSearchSchema.omit({
  cursor: true,
});
export const productSearchQuerySchema = productSearchSchema
  .omit({ cursor: true, limit: true })
  .extend({ limit: z.literal(3).default(3) });
export type ProductSearchQuery = z.output<typeof productSearchQuerySchema>;

export const productMatchReasonSchema = z.enum([
  'category_match',
  'size_match',
  'budget_match',
  'stock_available',
  'color_match',
  'style_match',
  'occasion_match',
  'fit_match',
  'preference_match',
]);
export type ProductMatchReason = z.infer<typeof productMatchReasonSchema>;

export type ProductResult = {
  externalId: string;
  name: string;
  brand: string | null;
  category: string;
  description: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  price: string;
  currency: 'CNY';
  sizes: string[];
  colors: string[];
  inStock: boolean;
  tryOnEnabled: boolean;
  matchReasons: ProductMatchReason[];
};

type CursorPayload = {
  version: 1;
  queryHash: string;
  score: number;
  externalId: string;
  externalSkuId: string;
  expiresAt: number;
};

type ProductSearchResponse = {
  items: ProductResult[];
  nextCursor: string | null;
  noResultReason:
    | 'NO_MATCHING_SIZE'
    | 'OVER_BUDGET'
    | 'OUT_OF_STOCK'
    | 'NO_MATCHING_PRODUCT'
    | null;
};

type ProductSearchRow = {
  external_id: string;
  external_sku_id: string;
  name: string;
  brand: string | null;
  category: string;
  description: string | null;
  product_url: string | null;
  image_url: string | null;
  price: string;
  lowest_price: string;
  color: string;
  size: string;
  available_stock: number;
  score: number;
  match_reasons: string[];
};

type ProductSkuRow = {
  sku_id: string;
  product_external_id: string;
  product_name: string;
  color: string;
  size: string;
  unit_price: string;
  currency: 'CNY';
  in_stock: boolean;
  image_url: string | null;
};

@Injectable()
export class ProductCatalogService {
  public constructor(
    @InjectRepository(Product)
    private readonly products: EntityRepository<Product>,
    private readonly config: ConfigService,
    @Inject(ProductCatalogTryOnService)
    private readonly tryOnProducts: ProductCatalogTryOnService,
  ) {}

  public async listSkus(
    query: ProductSkuQuery,
  ): Promise<ProductSkuPageResponse> {
    const manager = this.products.getEntityManager();
    const products = await manager
      .getConnection()
      .execute<Array<{ id: string }>>(
        `select id::text as id
         from products
         where external_id = ? and is_active = true`,
        [query.productExternalId],
      );
    const productId = products[0]?.id;
    if (!productId) throw new NotFoundException('商品不存在或不可用');

    const counts = await manager
      .getConnection()
      .execute<Array<{ total: string }>>(
        `select count(*)::text as total
         from product_skus
         where product_id = ?::uuid and is_active = true and currency = 'CNY'`,
        [productId],
      );
    const rows = await manager.getConnection().execute<ProductSkuRow[]>(
      `select s.id::text as sku_id, p.external_id as product_external_id,
           p.name as product_name, s.color, s.size, s.price::text as unit_price,
           s.currency,
           (s.stock - coalesce(r.reserved_quantity, 0)) > 0 as in_stock,
           s.image_url
         from product_skus s
         join products p on p.id = s.product_id
         left join active_order_sku_reservations r on r.sku_id = s.id
         where p.id = ?::uuid and p.is_active = true and s.is_active = true
           and s.currency = 'CNY'
         order by s.id asc
         limit ? offset ?`,
      [productId, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const items: ProductSkuResponse[] = rows.map((row) => ({
      skuId: row.sku_id,
      productExternalId: row.product_external_id,
      productName: row.product_name,
      color: row.color,
      size: row.size,
      unitPrice: row.unit_price,
      currency: row.currency,
      inStock: row.in_stock,
      imageUrl: validPublicUrl(row.image_url),
    }));
    return {
      items,
      total: Number(counts[0]?.total ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  public async search(
    input: ProductSearchInput,
  ): Promise<ProductSearchResponse> {
    if (
      input.budgetMin !== undefined &&
      input.budgetMax !== undefined &&
      input.budgetMin > input.budgetMax
    ) {
      return { items: [], nextCursor: null, noResultReason: 'OVER_BUDGET' };
    }
    const manager = this.products.getEntityManager();
    const secret = this.cursorSecret();
    const queryHash = createHmac('sha256', secret)
      .update(JSON.stringify({ ...input, cursor: undefined }))
      .digest('hex');
    const cursor = input.cursor
      ? this.decodeCursor(input.cursor, queryHash, secret)
      : null;
    const params: unknown[] = [];
    const where = [
      'p.is_active = true',
      's.is_active = true',
      "s.currency = 'CNY'",
    ];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql);
    };
    if (input.category) add('p.category = ?', input.category);
    if (input.size) add('lower(s.size) = lower(?)', input.size);
    if (input.color) add('lower(s.color) = lower(?)', input.color);
    if (input.budgetMin !== undefined)
      add('s.price >= ?::numeric', input.budgetMin);
    if (input.budgetMax !== undefined)
      add('s.price <= ?::numeric', input.budgetMax);
    if (input.inStock === true)
      where.push('(s.stock - coalesce(r.reserved_quantity, 0)) > 0');
    if (input.inStock === false)
      where.push('(s.stock - coalesce(r.reserved_quantity, 0)) = 0');

    const scoreParams: unknown[] = [];
    const signals: Array<{
      reason: ProductMatchReason;
      expression: string;
      value?: unknown;
    }> = [];
    if (input.category)
      signals.push({
        reason: 'category_match',
        expression: 'p.category = ?',
        value: input.category,
      });
    if (input.size)
      signals.push({
        reason: 'size_match',
        expression: 'lower(s.size) = lower(?)',
        value: input.size,
      });
    if (input.budgetMax !== undefined || input.budgetMin !== undefined) {
      signals.push({
        reason: 'budget_match',
        expression: `${input.budgetMin !== undefined ? 's.price >= ?::numeric' : 'true'} and ${input.budgetMax !== undefined ? 's.price <= ?::numeric' : 'true'}`,
        value: [input.budgetMin, input.budgetMax].filter(
          (value) => value !== undefined,
        ),
      });
    }
    if (input.inStock === true)
      signals.push({
        reason: 'stock_available',
        expression: '(s.stock - coalesce(r.reserved_quantity, 0)) > 0',
      });
    if (input.color)
      signals.push({
        reason: 'color_match',
        expression: 'lower(s.color) = lower(?)',
        value: input.color,
      });
    if (input.style)
      signals.push({
        reason: 'style_match',
        expression: 'p.styles @> ?::jsonb',
        value: JSON.stringify([input.style]),
      });
    if (input.occasion)
      signals.push({
        reason: 'occasion_match',
        expression: 'p.occasions @> ?::jsonb',
        value: JSON.stringify([input.occasion]),
      });
    if (input.fit)
      signals.push({
        reason: 'fit_match',
        expression: 'p.fits @> ?::jsonb',
        value: JSON.stringify([input.fit]),
      });
    const signalValues = (signal: (typeof signals)[number]) =>
      Array.isArray(signal.value)
        ? signal.value
        : signal.value === undefined
          ? []
          : [signal.value];
    const scoreParts = signals.map((signal) => {
      scoreParams.push(...signalValues(signal));
      return `case when ${signal.expression} then 1 else 0 end`;
    });
    const reasonParts = signals.map((signal) => {
      // SQL 的每个问号都是独立绑定，匹配理由表达式需要重复绑定评分条件。
      scoreParams.push(...signalValues(signal));
      return `case when (${signal.expression}) then '${signal.reason}' end`;
    });
    const scoreExpression = scoreParts.length ? scoreParts.join(' + ') : '0';
    const reasonExpression = reasonParts.length
      ? `array_remove(array[${reasonParts.join(',')}], null)`
      : 'array[]::text[]';
    const cursorParams: unknown[] = [];
    let cursorWhere = '';
    if (cursor) {
      cursorParams.push(
        cursor.score,
        cursor.score,
        cursor.externalId,
        cursor.externalSkuId,
      );
      cursorWhere =
        'where (score < ? or (score = ? and (external_id, external_sku_id) > (?, ?)))';
    }
    const limit = input.limit + 1;
    const sql = `
      with candidates as (
        select p.id as product_key, p.external_id, s.external_sku_id,
          p.name, p.brand, p.category,
          p.description, p.product_url, s.image_url, s.price, s.color, s.size,
          (s.stock - coalesce(r.reserved_quantity, 0))::integer as available_stock,
          (${scoreExpression}) as score, ${reasonExpression} as match_reasons
        from products p
        join product_skus s on s.product_id = p.id
        left join active_order_sku_reservations r on r.sku_id = s.id
        where ${where.join(' and ')}
      ), scored as (
        select *,
          min(price) over (partition by product_key) as lowest_price,
          row_number() over (
            partition by product_key
            order by score desc, external_sku_id asc
          ) as product_rank
        from candidates
      ), products_page as (
        select * from scored where product_rank = 1
      )
      select external_id, external_sku_id, name, brand, category, description,
        product_url, image_url, price::text, lowest_price::text, color, size,
        available_stock, score, match_reasons
      from products_page
      ${cursorWhere}
      order by score desc, external_id asc, external_sku_id asc
      limit ?
    `;
    const rows = await manager
      .getConnection()
      .execute<ProductSearchRow[]>(sql, [
        ...scoreParams,
        ...params,
        ...cursorParams,
        limit,
      ]);
    const hasMore = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    const grouped = new Map<string, ProductResult>();
    const tryOnProducts = await this.tryOnProducts.getTryOnProducts(
      pageRows.map((row) => row.external_id),
    );
    for (const row of pageRows) {
      const item = grouped.get(row.external_id);
      if (item) {
        item.sizes.push(row.size);
        item.colors.push(row.color);
        item.inStock ||= row.available_stock > 0;
        if (Number(row.price) < Number(item.price)) item.price = row.price;
      } else {
        grouped.set(row.external_id, {
          externalId: row.external_id,
          name: row.name,
          brand: row.brand,
          category: row.category,
          description: row.description,
          imageUrl: validPublicUrl(row.image_url),
          productUrl: validPublicUrl(row.product_url),
          price: row.lowest_price,
          currency: 'CNY',
          sizes: [row.size],
          colors: [row.color],
          inStock: row.available_stock > 0,
          tryOnEnabled:
            tryOnProducts.get(row.external_id)?.tryOnEnabled === true &&
            tryOnProducts.get(row.external_id)?.tryOnEligible === true,
          matchReasons: row.match_reasons.filter(isProductMatchReason),
        });
      }
    }
    const last = pageRows.at(-1);
    return {
      items: [...grouped.values()],
      nextCursor:
        hasMore && last
          ? this.encodeCursor(
              {
                version: 1,
                queryHash,
                score: Number(last.score),
                externalId: last.external_id,
                externalSkuId: last.external_sku_id,
                expiresAt: Date.now() + 15 * 60_000,
              },
              secret,
            )
          : null,
      noResultReason:
        pageRows.length === 0
          ? await this.explainNoResult(manager, input)
          : null,
    };
  }

  /**
   * 为推荐公开已登记的风格标签；商品属性仍由商品目录模块独占读取。
   */
  public async getRecommendationAttributes(
    externalIds: string[],
  ): Promise<
    Map<string, { styles: string[]; occasions: string[]; fits: string[] }>
  > {
    const ids = [...new Set(externalIds)].slice(0, 24);
    if (ids.length === 0) return new Map();
    const products = await this.products.find(
      { externalId: { $in: ids }, isActive: true },
      { fields: ['externalId', 'styles', 'occasions', 'fits'] },
    );
    return new Map(
      products.map((product) => [
        product.externalId,
        {
          styles: [...product.styles],
          occasions: [...product.occasions],
          fits: [...product.fits],
        },
      ]),
    );
  }

  public getNextPage(
    query: ProductSearchQuery,
    cursor: string,
  ): Promise<ProductSearchResponse> {
    return this.search({ ...query, cursor });
  }

  private async explainNoResult(
    manager: EntityManager,
    input: ProductSearchInput,
  ): Promise<ProductSearchResponse['noResultReason']> {
    if (input.inStock === true) {
      const filters = [
        'p.is_active = true',
        's.is_active = true',
        "s.currency = 'CNY'",
      ];
      const parameters: unknown[] = [];
      const addFilter = (expression: string, value: unknown) => {
        filters.push(expression);
        parameters.push(value);
      };
      if (input.category) addFilter('p.category = ?', input.category);
      if (input.size) addFilter('lower(s.size) = lower(?)', input.size);
      if (input.color) addFilter('lower(s.color) = lower(?)', input.color);
      if (input.budgetMin !== undefined)
        addFilter('s.price >= ?::numeric', input.budgetMin);
      if (input.budgetMax !== undefined)
        addFilter('s.price <= ?::numeric', input.budgetMax);
      if (input.style)
        addFilter('p.styles @> ?::jsonb', JSON.stringify([input.style]));
      if (input.occasion)
        addFilter('p.occasions @> ?::jsonb', JSON.stringify([input.occasion]));
      if (input.fit)
        addFilter('p.fits @> ?::jsonb', JSON.stringify([input.fit]));
      const count = await manager
        .getConnection()
        .execute<Array<{ total: string; available: string }>>(
          `select count(*)::text as total,
             count(*) filter (
               where s.stock - coalesce(r.reserved_quantity, 0) > 0
             )::text as available
           from products p
           join product_skus s on s.product_id = p.id
           left join active_order_sku_reservations r on r.sku_id = s.id
           where ${filters.join(' and ')}`,
          parameters,
        );
      if (
        Number(count[0]?.total ?? 0) > 0 &&
        Number(count[0]?.available ?? 0) === 0
      ) {
        return 'OUT_OF_STOCK';
      }
    }
    if (input.size) {
      const count = await manager.getConnection().execute<{ count: string }[]>(
        `select count(*)::text as count from products p join product_skus s on s.product_id=p.id
         where p.is_active=true and s.is_active=true and lower(s.size)=lower(?)`,
        [input.size],
      );
      if (Number(count[0]?.count ?? 0) === 0) return 'NO_MATCHING_SIZE';
    }
    if (input.budgetMax !== undefined) return 'OVER_BUDGET';
    return 'NO_MATCHING_PRODUCT';
  }

  private encodeCursor(payload: CursorPayload, secret: string): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update(body)
      .digest('base64url');
    return `${body}.${signature}`;
  }

  private decodeCursor(
    token: string,
    queryHash: string,
    secret: string,
  ): CursorPayload {
    const [body, signature] = token.split('.');
    if (!body || !signature) throw new BadRequestException('商品查询游标无效');
    const expected = createHmac('sha256', secret).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new BadRequestException('商品查询游标无效');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('商品查询游标无效');
    }
    const cursorSchema = z.strictObject({
      version: z.literal(1),
      queryHash: z.string().length(64),
      score: z.number(),
      externalId: z.string(),
      externalSkuId: z.string(),
      expiresAt: z.number().int(),
    });
    const result = cursorSchema.safeParse(parsed);
    if (
      !result.success ||
      result.data.queryHash !== queryHash ||
      result.data.expiresAt < Date.now()
    ) {
      throw new BadRequestException('商品查询游标无效或已过期');
    }
    return result.data;
  }

  private cursorSecret(): string {
    const secret = this.config.get<string>('PRODUCT_QUERY_CURSOR_SECRET');
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException('商品查询暂不可用');
    }
    return secret;
  }
}

function validPublicUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return publicProductUrl(value)?.toString() ?? null;
}

function isProductMatchReason(value: string): value is ProductMatchReason {
  return productMatchReasonSchema.safeParse(value).success;
}
