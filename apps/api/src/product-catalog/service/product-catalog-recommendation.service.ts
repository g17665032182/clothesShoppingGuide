import { Injectable } from '@nestjs/common';

import {
  ProductCatalogService,
  type ProductResult,
  type ProductSearchInput,
} from './product-catalog.service.js';
import type {
  ProductCatalogRecommendationItem,
  ProductCatalogRecommendationPort,
  ProductCatalogRecommendationSearchInput,
  ProductCatalogRecommendationSearchResult,
} from './product-catalog-recommendation.port.js';

@Injectable()
export class ProductCatalogRecommendationService implements ProductCatalogRecommendationPort {
  public constructor(private readonly catalog: ProductCatalogService) {}

  public async search(
    input: ProductCatalogRecommendationSearchInput,
  ): Promise<ProductCatalogRecommendationSearchResult> {
    const query: ProductSearchInput = {
      ...input,
      limit: Math.min(input.limit ?? 4, 4),
    };
    const result = await this.catalog.search(query);
    const attributes = await this.catalog.getRecommendationAttributes(
      result.items.map((item) => item.externalId),
    );
    return {
      items: result.items
        .filter(
          (
            item,
          ): item is ProductResult & {
            category: ProductCatalogRecommendationItem['category'];
          } => isRecommendationCategory(item.category),
        )
        .map((item) =>
          toRecommendationItem(item, attributes.get(item.externalId)),
        ),
      noResultReason: result.items.length === 0 ? result.noResultReason : null,
    };
  }
}

function toRecommendationItem(
  item: ProductResult & {
    category: ProductCatalogRecommendationItem['category'];
  },
  attributes:
    | { styles: string[]; occasions: string[]; fits: string[] }
    | undefined,
): ProductCatalogRecommendationItem {
  return {
    ...item,
    styles: attributes?.styles ?? [],
    occasions: attributes?.occasions ?? [],
    fits: attributes?.fits ?? [],
    matchReasons: [...new Set(item.matchReasons)].sort(),
  };
}

function isRecommendationCategory(
  value: string,
): value is ProductCatalogRecommendationItem['category'] {
  return (
    value === 'tops' ||
    value === 'bottoms' ||
    value === 'dresses' ||
    value === 'outerwear' ||
    value === 'shoes'
  );
}
