export const PRODUCT_CATALOG_TRY_ON_PORT = Symbol(
  'PRODUCT_CATALOG_TRY_ON_PORT',
);

export type TryOnProductProjection = {
  productExternalId: string;
  productName: string;
  category: 'tops' | 'bottoms' | 'dresses' | 'outerwear' | 'shoes';
  mainImageUrl: string | null;
  colors: Array<{
    color: string;
    imageUrl: string | null;
  }>;
};

export interface ProductCatalogTryOnPort {
  getTryOnProduct(
    productExternalId: string,
  ): Promise<TryOnProductProjection | null>;
}
