import { Inject, Injectable } from '@nestjs/common';

import {
  PRODUCT_CATALOG_RECOMMENDATION_PORT,
  type ProductCatalogRecommendationPort,
} from '../../product-catalog/index.js';
import { recommendationProductSchema } from '../context/recommendation-source.schema.js';
import type {
  RecommendationSourceSearchInput,
  RecommendationSourceSearchResult,
} from '../context/recommendation-source.schema.js';
import type { RecommendationProductSource } from '../port/recommendation-product-source.port.js';

@Injectable()
export class LocalProductCatalogSource implements RecommendationProductSource {
  public readonly sourceId = 'local_catalog';
  public readonly sourceType = 'local_catalog' as const;
  public readonly enabled = true;

  public constructor(
    @Inject(PRODUCT_CATALOG_RECOMMENDATION_PORT)
    private readonly catalog: ProductCatalogRecommendationPort,
  ) {}

  public async search(
    input: RecommendationSourceSearchInput,
  ): Promise<RecommendationSourceSearchResult> {
    const style = input.intent.styles?.[0];
    const result = await this.catalog.search({
      category: input.slot,
      ...(input.intent.size ? { size: input.intent.size } : {}),
      ...(input.intent.color ? { color: input.intent.color } : {}),
      ...(style ? { style } : {}),
      ...(input.intent.occasion ? { occasion: input.intent.occasion } : {}),
      ...(input.intent.fit ? { fit: input.intent.fit } : {}),
      ...(input.intent.budgetMin !== undefined
        ? { budgetMin: input.intent.budgetMin }
        : {}),
      ...(input.intent.budgetMax !== undefined
        ? { budgetMax: input.intent.budgetMax }
        : {}),
      ...(input.intent.inStock !== undefined
        ? { inStock: input.intent.inStock }
        : {}),
      limit: input.limit,
    });
    const observedAt = new Date().toISOString();
    const items = result.items.flatMap((item) => {
      const parsed = recommendationProductSchema.safeParse({
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        sourceProductRef: item.externalId,
        sourceSkuRef: null,
        name: item.name,
        brand: item.brand,
        category: item.category,
        imageUrl: item.imageUrl,
        productUrl: item.productUrl,
        price: item.price,
        currency: item.currency,
        inStock: item.inStock,
        styles: item.styles,
        occasions: item.occasions,
        colors: item.colors,
        fits: item.fits,
        observedAt,
        verifiedReasons: item.matchReasons,
      });
      return parsed.success ? [parsed.data] : [];
    });
    return {
      sourceId: this.sourceId,
      sourceType: this.sourceType,
      items,
      noResultReason: items.length ? null : result.noResultReason,
      observedAt,
    };
  }
}

/**
 * 在线来源保持禁用，等平台授权、地区和接口策略单独确认后再实现。
 * 拼多多与淘宝是后续优先评估对象，不在首期网络调用。
 */
export class DisabledOnlineProductSource implements RecommendationProductSource {
  public readonly enabled = false;
  public readonly sourceType: 'online_api' | 'mcp';

  public constructor(
    public readonly sourceId: string,
    sourceType: 'online_api' | 'mcp',
  ) {
    this.sourceType = sourceType;
  }

  public async search(
    _input: RecommendationSourceSearchInput,
  ): Promise<RecommendationSourceSearchResult> {
    throw new Error('在线商品来源尚未获批启用');
  }
}
