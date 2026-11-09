// 试穿模块只依赖商品目录公开端口，避免复制 token 导致 DI 容器出现两个 Symbol。
export {
  PRODUCT_CATALOG_TRY_ON_PORT,
  type ProductCatalogTryOnPort,
  type TryOnProductProjection,
} from '../../product-catalog/port/product-catalog-try-on.port.js';
