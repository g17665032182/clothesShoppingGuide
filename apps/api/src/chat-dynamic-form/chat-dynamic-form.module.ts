import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { ChatDynamicFormController } from './controller/chat-dynamic-form.controller.js';
import { ChatDynamicForm } from './entity/chat-dynamic-form.entity.js';
import { PurchaseRecipientFormHandler } from './handler/purchase-recipient-form.handler.js';
import {
  DYNAMIC_FORM_HANDLERS,
  DYNAMIC_FORM_PURCHASE_PORT,
} from './port/dynamic-form-handler.port.js';
import { ChatDynamicFormService } from './service/chat-dynamic-form.service.js';
import { DynamicFormRegistryService } from './service/dynamic-form-registry.service.js';
import { ChatPurchaseModule } from '../chat-purchase/index.js';
import { PurchaseRecipientFormAdapter } from './adapter/purchase-recipient-form.adapter.js';

@Module({
  imports: [MikroOrmModule.forFeature([ChatDynamicForm]), ChatPurchaseModule],
  controllers: [ChatDynamicFormController],
  providers: [
    ChatDynamicFormService,
    DynamicFormRegistryService,
    PurchaseRecipientFormHandler,
    PurchaseRecipientFormAdapter,
    {
      provide: DYNAMIC_FORM_PURCHASE_PORT,
      useExisting: PurchaseRecipientFormAdapter,
    },
    {
      provide: DYNAMIC_FORM_HANDLERS,
      useFactory: (purchase: PurchaseRecipientFormHandler) => [purchase],
      inject: [PurchaseRecipientFormHandler],
    },
  ],
  exports: [
    ChatDynamicFormService,
    DynamicFormRegistryService,
    PurchaseRecipientFormHandler,
  ],
})
export class ChatDynamicFormModule {}
