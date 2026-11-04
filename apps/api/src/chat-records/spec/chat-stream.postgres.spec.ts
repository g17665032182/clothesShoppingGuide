import 'reflect-metadata';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  AIMessageChunk,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { tool } from '@langchain/core/tools';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  Module,
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';

import config from '../../mikro-orm.config.js';
import { createLlmGraph } from '../../llm/graph/llm.graph.js';
import { LlmService } from '../../llm/service/llm.service.js';
import { FakeChatModel } from '../../llm/spec/fakes/fake-chat-model.js';
import { User } from '../../users/entity/user.entity.js';
import { ChatContextService } from '../context/chat-context.service.js';
import { ChatRecordsController } from '../controller/chat-records.controller.js';
import { LlmChatController } from '../controller/llm-chat.controller.js';
import { ChatDisplayService } from '../display/chat-display.service.js';
import type { PublicDisplayEnvelope } from '../display/chat-display.types.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import { ChatMessage } from '../entity/chat-message.entity.js';
import { ChatTraceEvent } from '../entity/chat-trace-event.entity.js';
import {
  ChatRecordsService,
  type ConversationDetailResponse,
} from '../service/chat-records.service.js';
import { ChatTraceWriterService } from '../trace/chat-trace-writer.service.js';

const privateToolValue = 'smoke-private-tool-value';

class HttpToolStreamModel extends FakeChatModel {
  private round = 0;

  public override async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
  ): AsyncGenerator<ChatGenerationChunk> {
    this.calls.push(messages);
    const round = this.round++;
    const id = `langchain-http-smoke-${round}`;
    const chunks =
      round % 2 === 0
        ? [
            new AIMessageChunk({ id, content: '先查询。' }),
            new AIMessageChunk({
              id,
              content: '',
              tool_call_chunks: [
                {
                  type: 'tool_call_chunk',
                  index: 0,
                  id: `call-http-smoke-${round}`,
                  name: 'local_echo_tool',
                  args: JSON.stringify({ value: privateToolValue }),
                },
              ],
            }),
          ]
        : [
            new AIMessageChunk({ id, content: '最终' }),
            new AIMessageChunk({
              id,
              content: '回答。',
              response_metadata: {
                tokenUsage: {
                  input_tokens: 12,
                  output_tokens: 8,
                  total_tokens: 20,
                },
              },
            }),
          ];
    for (const message of chunks) {
      yield new ChatGenerationChunk({
        text: typeof message.content === 'string' ? message.content : '',
        message,
      });
    }
  }
}

function parseFrames(text: string) {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event: '));
      const data = lines.find((line) => line.startsWith('data: '));
      assert.ok(event);
      assert.ok(data);
      return {
        type: event.slice('event: '.length),
        data: JSON.parse(data.slice('data: '.length)) as Record<
          string,
          unknown
        >,
      };
    });
}

test(
  '本地 HTTP + PostgreSQL：真实工具流、最终绑定、历史权限与失败回滚',
  {
    skip: process.env.RUN_CHAT_DISPLAY_POSTGRES_SMOKE !== '1',
    timeout: 60_000,
  },
  async (t) => {
    const entities = [User, ChatConversation, ChatMessage, ChatTraceEvent];
    const orm = await MikroORM.init({
      ...config,
      entities,
      entitiesTs: entities,
      debug: false,
    });
    const ownerId = randomUUID();
    const otherId = randomUUID();
    const owner = Object.assign(new User(), {
      id: ownerId,
      email: `chat-http-smoke-${ownerId}@local.invalid`,
      passwordHash: 'non-login-smoke-fixture',
      displayName: 'chat HTTP smoke fixture',
    });
    let app: INestApplication | undefined;
    try {
      const em = orm.em.fork();
      await em.persist(owner).flush();
      const llmConfig = new ConfigService({
        LLM_MODEL: 'fake-http-tool-model',
        LLM_CONTEXT_WINDOW_TOKENS: '65536',
        LLM_TOKEN_ENCODING: 'cl100k_base',
      });
      const model = new HttpToolStreamModel();
      const llm = new LlmService(
        createLlmGraph(model, [
          tool(async ({ value }: { value: string }) => `内部回显:${value}`, {
            name: 'local_echo_tool',
            description: '本地 HTTP 工具联调',
            schema: z.strictObject({ value: z.string() }),
          }),
        ]),
        llmConfig,
      );
      const traces = em.getRepository(ChatTraceEvent);
      const display = new ChatDisplayService(traces);
      let failMemoryEnqueue = false;
      const service = new ChatRecordsService(
        em.getRepository(ChatConversation),
        em.getRepository(ChatMessage),
        traces,
        llm,
        new ChatContextService(llmConfig, llm),
        { summarize: async () => null } as never,
        new ChatTraceWriterService(traces),
        { readContext: async () => '' } as never,
        {
          enqueueInTransaction: async () => {
            if (failMemoryEnqueue) throw new Error('controlled queue failure');
          },
        } as never,
        { markConversationDeleted: async () => undefined } as never,
        display,
        { readContext: async () => '' },
        { enqueueInTransaction: async () => undefined },
      );

      // tsx 不生成参数类型元数据；仅在测试内补 Nest 构造注入，不改业务接口。
      for (const controller of [LlmChatController, ChatRecordsController]) {
        Reflect.defineMetadata(
          'design:paramtypes',
          [ChatRecordsService],
          controller,
        );
      }
      @Module({
        controllers: [LlmChatController, ChatRecordsController],
        providers: [{ provide: ChatRecordsService, useValue: service }],
      })
      class HttpSmokeModule {}
      app = await NestFactory.create(HttpSmokeModule, {
        logger: false,
        abortOnError: false,
      });
      app.use(
        (
          request: {
            headers: Record<string, string | string[] | undefined>;
            user?: User;
          },
          _response: unknown,
          next: () => void,
        ) => {
          // 身份采用受控替身；资源归属和 404 行为仍由真实 ChatRecordsService 校验。
          request.user =
            request.headers['x-smoke-user'] === ownerId
              ? owner
              : Object.assign(new User(), { id: otherId });
          next();
        },
      );
      app.useGlobalPipes(new StandardSchemaValidationPipe());
      app.setGlobalPrefix('api');
      await app.listen(0, '127.0.0.1');
      const baseUrl = await app.getUrl();
      const post = (body: unknown, userId = ownerId) =>
        fetch(`${baseUrl}/api/llm/chat/stream`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-smoke-user': userId,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
      const response = await post({
        messages: [{ role: 'user', content: '推荐服装' }],
      });
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get('content-type') ?? '',
        /text\/event-stream/u,
      );
      const responseText = await response.text();
      const frames = parseFrames(responseText);
      assert.deepEqual(
        frames.map((frame) => frame.type),
        ['start', 'delta', 'activity', 'activity', 'delta', 'delta', 'done'],
      );
      const done = frames.at(-1)!;
      const conversationId = done.data.conversationId;
      assert.equal(typeof conversationId, 'string');
      const id = conversationId as string;
      const content = frames
        .filter((frame) => frame.type === 'delta')
        .map((frame) => frame.data.content)
        .join('');
      assert.equal(content, '先查询。最终回答。');
      assert.equal(responseText.includes(privateToolValue), false);
      assert.equal(
        model.calls[1]?.some(
          (message) =>
            message instanceof ToolMessage &&
            message.content === `内部回显:${privateToolValue}`,
        ),
        true,
      );

      const fresh = orm.em.fork();
      const messages = await fresh.find(
        ChatMessage,
        { conversationId: id },
        { orderBy: { createdAt: 'asc' } },
      );
      assert.equal(messages.length, 2);
      const assistant = messages.find(
        (message) => message.role === 'assistant',
      )!;
      assert.equal(assistant.content, content);
      const savedTraces = await fresh.find(
        ChatTraceEvent,
        { conversationId: id },
        { orderBy: { sequence: 'asc' } },
      );
      assert.deepEqual(
        savedTraces.map((trace) => trace.eventType),
        [
          'input',
          'model_response',
          'tool_call',
          'tool_result',
          'model_response',
        ],
      );
      const final = savedTraces.at(-1)!;
      const envelope = (final.payload as Record<string, unknown>)
        .publicDisplay as PublicDisplayEnvelope;
      assert.equal(final.sequence, 4);
      assert.equal(final.messageId, 'langchain-http-smoke-1');
      assert.equal(envelope.assistantMessageId, assistant.id);
      assert.notEqual(final.messageId, assistant.id);
      assert.equal(savedTraces[1]?.payload, null);
      assert.equal(envelope.activities.length, 1);
      assert.deepEqual(envelope.context, done.data.context);
      assert.equal(envelope.context?.usedTokens, 20);

      const historyResponse = await fetch(
        `${baseUrl}/api/chat/conversations/${id}?page=1&pageSize=20`,
        { headers: { 'x-smoke-user': ownerId } },
      );
      assert.equal(historyResponse.status, 200);
      const history =
        (await historyResponse.json()) as ConversationDetailResponse;
      const historicAssistant = history.messages.items.find(
        (message) => message.id === assistant.id,
      )!;
      assert.equal(historicAssistant.content, content);
      assert.deepEqual(historicAssistant.activities, envelope.activities);
      assert.deepEqual(historicAssistant.sources, envelope.sources);
      assert.deepEqual(historicAssistant.context, envelope.context);
      assert.equal(JSON.stringify(history).includes(privateToolValue), false);
      const forbidden = await fetch(`${baseUrl}/api/chat/conversations/${id}`, {
        headers: { 'x-smoke-user': otherId },
      });
      assert.equal(forbidden.status, 404);
      const forbiddenPost = await post(
        {
          conversationId: id,
          messages: [{ role: 'user', content: '越权请求' }],
        },
        otherId,
      );
      assert.equal(forbiddenPost.status, 404);
      const invalid = await post({
        conversationId: id,
        messages: [{ role: 'user', content: '合法字段' }],
        unknownField: true,
      });
      assert.equal(invalid.status, 400);
      t.diagnostic(
        '真实 HTTP 工具流正文逐段保存，最终 trace 独立绑定，GET 元数据一致且越权 404',
      );

      failMemoryEnqueue = true;
      const failed = await post({
        conversationId: id,
        messages: [{ role: 'user', content: '验证事务回滚' }],
      });
      assert.equal(failed.status, 200);
      const failedText = await failed.text();
      const failedFrames = parseFrames(failedText);
      assert.equal(failedFrames.at(-1)?.type, 'error');
      assert.equal(
        failedFrames.some((frame) => frame.type === 'done'),
        false,
      );
      assert.equal(failedText.includes('controlled queue failure'), false);
      const afterFailure = orm.em.fork();
      assert.equal(
        await afterFailure.count(ChatMessage, { conversationId: id }),
        2,
      );
      const allTraces = await afterFailure.find(ChatTraceEvent, {
        conversationId: id,
      });
      assert.equal(allTraces.length, 10);
      const boundTraces = allTraces.filter(
        (trace) =>
          trace.payload !== null &&
          Object.hasOwn(trace.payload, 'publicDisplay'),
      );
      assert.equal(boundTraces.length, 1);
      assert.equal(boundTraces[0]?.id, final.id);
      t.diagnostic(
        '记忆入队故障使新消息和展示绑定全部回滚，SSE error 后无 done；内部 trace 保留',
      );
    } finally {
      try {
        await app?.close();
      } finally {
        const cleanup = orm.em.fork();
        try {
          await cleanup.transactional(async (transaction) => {
            const conversations = await transaction.find(ChatConversation, {
              userId: ownerId,
            });
            const ids = conversations.map((conversation) => conversation.id);
            if (ids.length > 0) {
              await transaction.nativeDelete(ChatTraceEvent, {
                conversationId: { $in: ids },
              });
              await transaction.nativeDelete(ChatMessage, {
                conversationId: { $in: ids },
              });
              await transaction.nativeDelete(ChatConversation, {
                id: { $in: ids },
              });
            }
            await transaction.nativeDelete(User, { id: ownerId });
          });
        } finally {
          await orm.close();
        }
      }
    }
  },
);
