import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { createLlmGraph, type LlmTool } from './graph/llm.graph.js';
import {
  LLM_CHAT_MODEL,
  LLM_GRAPH,
  LLM_GRAPH_FACTORY,
} from './graph/llm.tokens.js';
import { LlmService } from './service/llm.service.js';
import { ChatModelFactory } from './provider/chat-model.factory.js';
import { createConfiguredTools } from './tools/tool-registry.js';
import { LLM_MODEL_NAME } from './port/structured-text-generation.tokens.js';
import { StructuredTextGenerationService } from './port/structured-text-generation.service.js';
import { STRUCTURED_TEXT_GENERATION_PORT } from './port/structured-text-generation.port.js';
import { WEATHER_MCP_PORT } from './weather-mcp/weather-mcp.port.js';
import { WeatherMcpService } from './weather-mcp/weather-mcp.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [],
  providers: [
    ChatModelFactory,
    WeatherMcpService,
    {
      provide: WEATHER_MCP_PORT,
      useExisting: WeatherMcpService,
    },
    {
      provide: LLM_CHAT_MODEL,
      inject: [ChatModelFactory],
      useFactory: (factory: ChatModelFactory): BaseChatModel =>
        factory.create(),
    },
    {
      provide: LLM_MODEL_NAME,
      inject: [ChatModelFactory],
      useFactory: (factory: ChatModelFactory): string =>
        factory.readModelName(),
    },
    {
      provide: LLM_GRAPH,
      inject: [LLM_CHAT_MODEL, ConfigService],
      useFactory: (model: BaseChatModel, config: ConfigService) =>
        createLlmGraph(model, createConfiguredTools(config)),
    },
    {
      provide: LLM_GRAPH_FACTORY,
      inject: [LLM_CHAT_MODEL, ConfigService],
      useFactory:
        (model: BaseChatModel, config: ConfigService) =>
        (extraTools: LlmTool[]) =>
          createLlmGraph(model, [
            ...createConfiguredTools(config),
            ...extraTools,
          ]),
    },
    LlmService,
    StructuredTextGenerationService,
    {
      provide: STRUCTURED_TEXT_GENERATION_PORT,
      useExisting: StructuredTextGenerationService,
    },
  ],
  exports: [
    LlmService,
    STRUCTURED_TEXT_GENERATION_PORT,
    LLM_GRAPH_FACTORY,
    WEATHER_MCP_PORT,
  ],
})
export class LlmModule {}
