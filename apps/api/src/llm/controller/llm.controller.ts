import { Body, Controller, Post } from '@nestjs/common';

import { ChatDto, chatSchema } from '../dto/chat.dto.js';
import { LlmService, type ChatOutput } from '../service/llm.service.js';

@Controller('llm')
export class LlmController {
  public constructor(private readonly llmService: LlmService) {}

  @Post('chat')
  public chat(
    @Body({ schema: chatSchema }) body: ChatDto,
  ): Promise<ChatOutput> {
    return this.llmService.chat({
      messages: body.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });
  }
}
