import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { LlmModule } from '../llm/llm.module.js';
import { UserMemoryModule } from '../user-memory/index.js';
import { UserPreferencesModule } from '../user-preferences/index.js';
import { ProductCatalogModule } from '../product-catalog/index.js';
import { AdminChatRecordsController } from './controller/admin-chat-records.controller.js';
import { ChatContextService } from './context/chat-context.service.js';
import { ChatConversation } from './entity/chat-conversation.entity.js';
import { ChatTraceEvent } from './entity/chat-trace-event.entity.js';
import { ChatMessage } from './entity/chat-message.entity.js';
import { ChatRecordsController } from './controller/chat-records.controller.js';
import { ChatRecordsService } from './service/chat-records.service.js';
import { ChatSummaryService } from './service/chat-summary.service.js';
import { ChatTraceWriterService } from './trace/chat-trace-writer.service.js';
import { LlmChatController } from './controller/llm-chat.controller.js';
import { ChatDisplayService } from './display/chat-display.service.js';
import { ChatPurchaseModule } from '../chat-purchase/index.js';
import { ChatConversationAccessModule } from './conversation-access/index.js';
import { OrdersModule } from '../orders/index.js';
import { UserAddressesModule } from '../user-addresses/index.js';
import { VirtualTryOnModule } from '../virtual-try-on/virtual-try-on.module.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([ChatConversation, ChatMessage, ChatTraceEvent]),
    LlmModule,
    UserMemoryModule,
    UserPreferencesModule,
    ProductCatalogModule,
    ChatPurchaseModule,
    ChatConversationAccessModule,
    OrdersModule,
    UserAddressesModule,
    VirtualTryOnModule,
  ],
  controllers: [
    ChatRecordsController,
    AdminChatRecordsController,
    LlmChatController,
  ],
  providers: [
    ChatContextService,
    ChatSummaryService,
    ChatTraceWriterService,
    ChatRecordsService,
    ChatDisplayService,
  ],
})
export class ChatRecordsModule {}
