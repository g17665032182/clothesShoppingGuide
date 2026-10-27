import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { LlmModule } from '../llm/llm.module.js';
import { AdminChatRecordsController } from './admin-chat-records.controller.js';
import { ChatContextService } from './chat-context.service.js';
import { ChatConversation } from './chat-conversation.entity.js';
import { ChatMessage } from './chat-message.entity.js';
import { ChatRecordsController } from './chat-records.controller.js';
import { ChatRecordsService } from './chat-records.service.js';
import { ChatSummaryService } from './chat-summary.service.js';
import { LlmChatController } from './llm-chat.controller.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([ChatConversation, ChatMessage]),
    LlmModule,
  ],
  controllers: [
    ChatRecordsController,
    AdminChatRecordsController,
    LlmChatController,
  ],
  providers: [ChatContextService, ChatSummaryService, ChatRecordsService],
})
export class ChatRecordsModule {}
