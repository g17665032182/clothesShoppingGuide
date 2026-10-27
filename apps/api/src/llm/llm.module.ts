import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { LlmController } from './llm.controller.js';
import { createLlmGraph } from './llm.graph.js';
import { LLM_CHAT_MODEL, LLM_GRAPH } from './llm.tokens.js';
import { LlmService } from './llm.service.js';
import { ChatModelFactory } from './providers/chat-model.factory.js';

@Module({
  imports: [ConfigModule],
  controllers: [LlmController],
  providers: [
    ChatModelFactory,
    {
      provide: LLM_CHAT_MODEL,
      inject: [ChatModelFactory],
      useFactory: (factory: ChatModelFactory): BaseChatModel =>
        factory.create(),
    },
    {
      provide: LLM_GRAPH,
      inject: [LLM_CHAT_MODEL],
      useFactory: (model: BaseChatModel) => createLlmGraph(model),
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
