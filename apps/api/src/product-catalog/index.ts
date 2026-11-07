export { ProductCatalogModule } from './product-catalog.module.js';
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
