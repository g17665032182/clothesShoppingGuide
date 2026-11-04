import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { UsersModule } from '../../users/index.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import { ChatMessage } from '../entity/chat-message.entity.js';
import { CHAT_EXTRACTION_SOURCE } from './chat-extraction-source.port.js';
import { ChatExtractionSourceService } from './chat-extraction-source.service.js';

@Module({
  imports: [
    UsersModule,
    MikroOrmModule.forFeature([ChatConversation, ChatMessage]),
  ],
  providers: [
    ChatExtractionSourceService,
    {
      provide: CHAT_EXTRACTION_SOURCE,
      useExisting: ChatExtractionSourceService,
    },
  ],
  exports: [CHAT_EXTRACTION_SOURCE],
})
export class ChatExtractionSourceModule {}
