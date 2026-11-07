import type { EntityManager } from '@mikro-orm/core';

export const PRODUCT_CATALOG_ORDER_PORT = Symbol('PRODUCT_CATALOG_ORDER_PORT');

export type ProductCatalogOrderSku = {
  skuId: string;
  productExternalId: string;
  externalSkuId: string;
  productName: string;
  color: string;
  size: string;
  price: string;
  currency: string;
  stock: number;
  isProductActive: boolean;
  isSkuActive: boolean;
  imageUrl: string | null;
};

export type ProductCatalogOrderQuantity = {
  skuId: string;
  quantity: number;
};

export type ProductCatalogSkuExternalKey = {
  productExternalId: string;
  externalSkuId: string;
};

export type ProductCatalogSkuIdentity = {
  skuId: string;
  productExternalId: string;
  externalSkuId: string;
};

export interface ProductCatalogOrderPort {
  lockSkus(
    entityManager: EntityManager,
    skuIds: string[],
  ): Promise<ProductCatalogOrderSku[]>;
  getReservedQuantities(
    entityManager: EntityManager,
    skuIds: string[],
  ): Promise<Map<string, number>>;
  decrementStockForShipment(
    entityManager: EntityManager,
    quantities: ProductCatalogOrderQuantity[],
  ): Promise<void>;
  listSkuIdsForCatalogChanges(
    entityManager: EntityManager,
    productExternalIds: string[],
    skuExternalKeys: ProductCatalogSkuExternalKey[],
  ): Promise<string[]>;
  getSkuIdsForCatalogChanges(
    entityManager: EntityManager,
    productExternalIds: string[],
    skuExternalKeys: ProductCatalogSkuExternalKey[],
  ): Promise<ProductCatalogSkuIdentity[]>;
}
