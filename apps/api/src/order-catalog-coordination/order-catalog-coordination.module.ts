import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/index.js';
import { ProductCatalogModule } from '../product-catalog/index.js';
import { OrderCatalogImportService } from './service/order-catalog-import.service.js';

@Module({
  imports: [OrdersModule, ProductCatalogModule],
  providers: [OrderCatalogImportService],
  exports: [OrderCatalogImportService],
})
export class OrderCatalogCoordinationModule {}
