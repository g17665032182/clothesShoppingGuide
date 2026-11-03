import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { LlmModule } from '../llm/llm.module.js';
import { UserMemoryModule } from '../user-memory/user-memory.module.js';
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

@Module({
  imports: [
    MikroOrmModule.forFeature([ChatConversation, ChatMessage, ChatTraceEvent]),
    LlmModule,
    UserMemoryModule,
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
