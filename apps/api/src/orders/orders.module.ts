import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { ProductCatalogModule } from '../product-catalog/index.js';
import { AdminOrdersController } from './controller/admin-orders.controller.js';
import { OrdersController } from './controller/orders.controller.js';
import { Order } from './entity/order.entity.js';
import { OrderIdempotency } from './entity/order-idempotency.entity.js';
import { OrderItem } from './entity/order-item.entity.js';
import { OrderExpirationService } from './service/order-expiration.service.js';
import { OrdersService } from './service/orders.service.js';
import { ORDER_CATALOG_IMPORT_PORT } from './port/order-catalog-import.port.js';
import { ORDER_CONFIRMED_CREATION_PORT } from './port/order-confirmed-creation.port.js';

@Module({
  imports: [
    ProductCatalogModule,
    MikroOrmModule.forFeature([Order, OrderItem, OrderIdempotency]),
  ],
  controllers: [OrdersController, AdminOrdersController],
  providers: [
    OrdersService,
    OrderExpirationService,
    {
      provide: ORDER_CATALOG_IMPORT_PORT,
      useExisting: OrdersService,
    },
    {
      provide: ORDER_CONFIRMED_CREATION_PORT,
      useExisting: OrdersService,
    },
  ],
  exports: [
    OrdersService,
    ORDER_CATALOG_IMPORT_PORT,
    ORDER_CONFIRMED_CREATION_PORT,
  ],
})
export class OrdersModule {}
