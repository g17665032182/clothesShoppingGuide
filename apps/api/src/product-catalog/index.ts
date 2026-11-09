export { ProductCatalogModule } from './product-catalog.module.js';
export {
  PRODUCT_TRY_ON_IMAGE_STORE,
  type ProductTryOnImageStore,
} from './port/product-try-on-image-store.port.js';
export {
  ProductCatalogService,
  productSearchQuerySchema,
  productSearchSchema,
  productSearchToolSchema,
  type ProductSearchInput,
  type ProductSearchQuery,
  type ProductResult,
  type ProductMatchReason,
} from './service/product-catalog.service.js';
export { ProductCatalogImportService } from './service/product-catalog-import.service.js';
export type { ProductCatalogImportResult } from './service/product-catalog-import.service.js';
export { ProductCatalogOrderService } from './service/product-catalog-order.service.js';
export {
  PRODUCT_CATALOG_PURCHASE_PORT,
  type ProductCatalogPurchasePort,
  type ProductCatalogPurchaseProjection,
} from './port/product-catalog-purchase.port.js';
export {
  PRODUCT_CATALOG_TRY_ON_PORT,
  type ProductCatalogTryOnPort,
  type TryOnProductProjection,
} from './port/product-catalog-try-on.port.js';
export type { ProductSkuResponse } from './dto/product-sku-response.dto.js';
export { normalizeProductPublicUrl } from './public-url.js';
export {
  productCatalogImportSchema,
  type ProductCatalogImport,
} from './import/product-catalog-import.schema.js';
export {
  PRODUCT_CATALOG_ORDER_PORT,
  type ProductCatalogOrderPort,
  type ProductCatalogOrderQuantity,
  type ProductCatalogOrderSku,
  type ProductCatalogSkuIdentity,
  type ProductCatalogSkuExternalKey,
} from './service/product-catalog-order.port.js';
