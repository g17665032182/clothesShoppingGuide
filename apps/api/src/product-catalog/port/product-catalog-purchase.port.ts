import type { EntityManager } from '@mikro-orm/core';

import type { ProductSkuResponse } from '../dto/product-sku-response.dto.js';

export const PRODUCT_CATALOG_PURCHASE_PORT = Symbol(
  'PRODUCT_CATALOG_PURCHASE_PORT',
);

export type ProductCatalogPurchaseProjection = {
  productExternalId: string;
  productName: string;
  skus: ProductSkuResponse[];
};

export interface ProductCatalogPurchasePort {
  getPurchaseSpecifications(
    em: EntityManager,
    productExternalId: string,
  ): Promise<ProductCatalogPurchaseProjection | null>;
}
