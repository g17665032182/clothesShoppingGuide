import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ConfigService } from '@nestjs/config';

import { LocalPrivateObjectStorageService } from '../common/storage/local-private-object-storage.service.js';
import { Product } from './entity/product.entity.js';
import { ProductSku } from './entity/product-sku.entity.js';
import { ProductCatalogController } from './controller/product-catalog.controller.js';
import { ProductSkuController } from './controller/product-sku.controller.js';
import { ProductCatalogService } from './service/product-catalog.service.js';
import { ProductCatalogImportService } from './service/product-catalog-import.service.js';
import { ProductCatalogOrderService } from './service/product-catalog-order.service.js';
import { PRODUCT_CATALOG_ORDER_PORT } from './service/product-catalog-order.port.js';
import { AdminProductCatalogController } from './controller/admin-product-catalog.controller.js';
import { AdminProductCatalogService } from './service/admin-product-catalog.service.js';
import { ProductCatalogPurchaseService } from './service/product-catalog-purchase.service.js';
import { PRODUCT_CATALOG_PURCHASE_PORT } from './port/product-catalog-purchase.port.js';
import { PRODUCT_CATALOG_TRY_ON_PORT } from './port/product-catalog-try-on.port.js';
import { ProductCatalogTryOnService } from './service/product-catalog-try-on.service.js';
import { AdminProductTryOnImageController } from './controller/admin-product-try-on-image.controller.js';
import { ProductTryOnImageService } from './service/product-try-on-image.service.js';
import { ProductTryOnImageProcessingService } from './service/product-try-on-image-processing.service.js';
import { LocalProductTryOnImageStoreService } from './service/local-product-try-on-image-store.service.js';
import { QiniuProductTryOnImageStoreService } from './service/qiniu-product-try-on-image-store.service.js';
import { PRODUCT_TRY_ON_IMAGE_STORE } from './port/product-try-on-image-store.port.js';

@Module({
  imports: [MikroOrmModule.forFeature([Product, ProductSku])],
  controllers: [
    ProductCatalogController,
    ProductSkuController,
    AdminProductCatalogController,
    AdminProductTryOnImageController,
  ],
  providers: [
    ProductCatalogService,
    ProductCatalogImportService,
    ProductCatalogOrderService,
    AdminProductCatalogService,
    ProductCatalogPurchaseService,
    ProductCatalogTryOnService,
    ProductTryOnImageService,
    ProductTryOnImageProcessingService,
    LocalPrivateObjectStorageService,
    LocalProductTryOnImageStoreService,
    QiniuProductTryOnImageStoreService,
    {
      provide: PRODUCT_TRY_ON_IMAGE_STORE,
      useFactory: (
        config: ConfigService,
        qiniuStore: QiniuProductTryOnImageStoreService,
        localStore: LocalProductTryOnImageStoreService,
      ) => {
        const driver = config.get<string>('TRY_ON_STORAGE_DRIVER') ?? 'qiniu';
        if (driver === 'local') {
          if (config.get<string>('NODE_ENV') !== 'development')
            throw new Error('本地试穿存储只允许在 development 环境启用');
          return localStore;
        }
        if (driver !== 'qiniu')
          throw new Error('TRY_ON_STORAGE_DRIVER 配置无效');
        return qiniuStore;
      },
      inject: [
        ConfigService,
        QiniuProductTryOnImageStoreService,
        LocalProductTryOnImageStoreService,
      ],
    },
    {
      provide: PRODUCT_CATALOG_PURCHASE_PORT,
      useExisting: ProductCatalogPurchaseService,
    },
    {
      provide: PRODUCT_CATALOG_TRY_ON_PORT,
      useExisting: ProductCatalogTryOnService,
    },
    {
      provide: PRODUCT_CATALOG_ORDER_PORT,
      useExisting: ProductCatalogOrderService,
    },
  ],
  exports: [
    ProductCatalogService,
    ProductCatalogImportService,
    PRODUCT_CATALOG_ORDER_PORT,
    PRODUCT_CATALOG_PURCHASE_PORT,
    PRODUCT_CATALOG_TRY_ON_PORT,
    PRODUCT_TRY_ON_IMAGE_STORE,
  ],
})
export class ProductCatalogModule {}
