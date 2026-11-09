export const PRODUCT_CATALOG_TRY_ON_PORT = Symbol(
  'PRODUCT_CATALOG_TRY_ON_PORT',
);

export type TryOnProductProjection = {
  productExternalId: string;
  productName: string;
  category: 'tops' | 'bottoms' | 'dresses' | 'outerwear' | 'shoes';
  /** 管理员保存的开关与当前目录资格分离，避免把失效商品误判为可试穿。 */
  tryOnEnabled: boolean;
  tryOnEligible: boolean;
  tryOnImageObjectKey: string | null;
  mainImageUrl: string | null;
  colors: Array<{
    color: string;
    imageUrl: string | null;
  }>;
};

export interface ProductCatalogTryOnPort {
  getTryOnProducts(
    productExternalIds: string[],
  ): Promise<Map<string, TryOnProductProjection>>;
  getTryOnProduct(
    productExternalId: string,
  ): Promise<TryOnProductProjection | null>;
}
