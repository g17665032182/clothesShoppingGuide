import { Body, Controller, Post } from '@nestjs/common';

import { CurrentUser } from '../auth/decorator/current-user.decorator.js';
import { ChatDto } from '../llm/dto/chat.dto.js';
import type { User } from '../users/user.entity.js';
import {
  ChatRecordsService,
  type PersistedChatOutput,
} from './chat-records.service.js';

@Controller('llm')
export class LlmChatController {
  public constructor(private readonly chatRecords: ChatRecordsService) {}

  @Post('chat')
  public chat(
    @CurrentUser() user: User,
    @Body() body: ChatDto,
  ): Promise<PersistedChatOutput> {
    return this.chatRecords.chat(user, body);
  }
}
