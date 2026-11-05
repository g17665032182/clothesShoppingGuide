import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { Product } from './entity/product.entity.js';
import { ProductSku } from './entity/product-sku.entity.js';
import { ProductCatalogController } from './controller/product-catalog.controller.js';
import { ProductCatalogService } from './service/product-catalog.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([Product, ProductSku])],
  controllers: [ProductCatalogController],
  providers: [ProductCatalogService],
  exports: [ProductCatalogService],
})
export class ProductCatalogModule {}
