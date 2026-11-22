export type ProductCatalogRecommendationCategory =
  | 'tops'
  | 'bottoms'
  | 'dresses'
  | 'outerwear'
  | 'shoes';

export type ProductCatalogRecommendationSearchInput = {
  category?: ProductCatalogRecommendationCategory;
  size?: string;
  color?: string;
  style?: string;
  occasion?: string;
  fit?: string;
  budgetMin?: number;
  budgetMax?: number;
  inStock?: boolean;
  limit?: number;
};

export type ProductCatalogRecommendationItem = {
  externalId: string;
  name: string;
  brand: string | null;
  category: ProductCatalogRecommendationCategory;
  description: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  price: string;
  currency: 'CNY';
  sizes: string[];
  colors: string[];
  styles: string[];
  occasions: string[];
  fits: string[];
  inStock: boolean;
  tryOnEnabled: boolean;
  matchReasons: string[];
};

export type ProductCatalogRecommendationSearchResult = {
  items: ProductCatalogRecommendationItem[];
  noResultReason:
    | 'NO_MATCHING_SIZE'
    | 'OVER_BUDGET'
    | 'OUT_OF_STOCK'
    | 'NO_MATCHING_PRODUCT'
    | null;
};

export const PRODUCT_CATALOG_RECOMMENDATION_PORT = Symbol(
  'PRODUCT_CATALOG_RECOMMENDATION_PORT',
);

export interface ProductCatalogRecommendationPort {
  search(
    input: ProductCatalogRecommendationSearchInput,
  ): Promise<ProductCatalogRecommendationSearchResult>;
}
