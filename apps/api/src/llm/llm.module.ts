import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { createLlmGraph } from './graph/llm.graph.js';
import { LLM_CHAT_MODEL, LLM_GRAPH } from './graph/llm.tokens.js';
import { LlmService } from './service/llm.service.js';
import { ChatModelFactory } from './provider/chat-model.factory.js';
import { createLocalEchoTool } from './tools/local-echo.tool.js';

@Module({
  imports: [ConfigModule],
  controllers: [],
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
      inject: [LLM_CHAT_MODEL, ConfigService],
      useFactory: (model: BaseChatModel, config: ConfigService) =>
        createLlmGraph(
          model,
          config.get<string>('LLM_ENABLE_LOCAL_TEST_TOOL') === 'true'
            ? [createLocalEchoTool()]
            : [],
        ),
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
