import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ChatConversationAccessModule } from '../chat-records/conversation-access/index.js';
import { ProductCatalogModule } from '../product-catalog/index.js';
import { OrdersModule } from '../orders/index.js';
import { UserAddressesModule } from '../user-addresses/index.js';
import { ChatPurchaseDraft } from './entity/chat-purchase-draft.entity.js';
import { PurchaseDraftService } from './service/purchase-draft.service.js';
import { PurchaseProjectionService } from './service/purchase-projection.service.js';
import { PurchaseConfirmationService } from './service/purchase-confirmation.service.js';
import { ChatPurchaseController } from './controller/chat-purchase.controller.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([ChatPurchaseDraft]),
    ChatConversationAccessModule,
    ProductCatalogModule,
    OrdersModule,
    UserAddressesModule,
  ],
  controllers: [ChatPurchaseController],
  providers: [
    PurchaseDraftService,
    PurchaseProjectionService,
    PurchaseConfirmationService,
  ],
  exports: [PurchaseDraftService],
})
export class ChatPurchaseModule {}
