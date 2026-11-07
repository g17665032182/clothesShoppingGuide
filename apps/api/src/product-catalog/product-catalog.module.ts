import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

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

@Module({
  imports: [MikroOrmModule.forFeature([Product, ProductSku])],
  controllers: [
    ProductCatalogController,
    ProductSkuController,
    AdminProductCatalogController,
  ],
  providers: [
    ProductCatalogService,
    ProductCatalogImportService,
    ProductCatalogOrderService,
    AdminProductCatalogService,
    {
      provide: PRODUCT_CATALOG_ORDER_PORT,
      useExisting: ProductCatalogOrderService,
    },
  ],
  exports: [
    ProductCatalogService,
    ProductCatalogImportService,
    PRODUCT_CATALOG_ORDER_PORT,
  ],
})
export class ProductCatalogModule {}
