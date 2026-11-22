import 'reflect-metadata';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  AIMessage,
  AIMessageChunk,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { EntityManager, EventArgs } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  Module,
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { ChatUserInformationService } from '../../chat-user-information/index.js';
import { createLlmGraph } from '../../llm/graph/llm.graph.js';
import { LlmService } from '../../llm/service/llm.service.js';
import { FakeChatModel } from '../../llm/spec/fakes/fake-chat-model.js';
import config from '../../mikro-orm.config.js';
import { UserMemoryTask } from '../../user-memory/entity/user-memory-task.entity.js';
import { UserMemoryTaskService } from '../../user-memory/service/user-memory-task.service.js';
import { User, UserStatus } from '../../users/entity/user.entity.js';
import { UsersService } from '../../users/service/users.service.js';
import { TryOnResult } from '../../virtual-try-on/entity/try-on-result.entity.js';
import {
  TryOnTask,
  TryOnTaskStatus,
} from '../../virtual-try-on/entity/try-on-task.entity.js';
import { TryOnTaskReaderService } from '../../virtual-try-on/index.js';
import { ChatContextService } from '../context/chat-context.service.js';
import { ChatRecordsController } from '../controller/chat-records.controller.js';
import { LlmChatController } from '../controller/llm-chat.controller.js';
import { ChatConversationAccess } from '../conversation-access/index.js';
import { ChatDisplayService } from '../display/chat-display.service.js';
import type { PublicDisplayEnvelope } from '../display/chat-display.types.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import { ChatMessage } from '../entity/chat-message.entity.js';
import {
  ChatTraceEvent,
  ChatTraceEventType,
} from '../entity/chat-trace-event.entity.js';
import { ChatExtractionSourceService } from '../extraction-source/chat-extraction-source.service.js';
import { mapTraceEventsToMessages } from '../history/chat-history.mapper.js';
import {
  ChatRecordsService,
  type ConversationDetailResponse,
} from '../service/chat-records.service.js';
import { eligibleSummaryTraceIds } from '../service/chat-summary-source.js';
import { ChatTraceWriterService } from '../trace/chat-trace-writer.service.js';

const PRIVATE_VALUE = 'private-try-on-information-fixture';

/** 同一个假模型同时驱动 JSON 和流式的实际 ToolNode，不访问任何供应商。 */
class TryOnInformationModel extends FakeChatModel {
  private decide(messages: BaseMessage[]): AIMessage {
    this.calls.push(messages);
    const latest = messages.at(-1);
    const id = `model-${randomUUID()}`;
    if (latest instanceof ToolMessage) {
      return new AIMessage({ id, content: '已查询，请到我的试穿查看。' });
    }
    const content = String(latest?.content ?? '');
    if (content.includes('普通聊天')) {
      return new AIMessage({ id, content: '继续讨论日常穿搭。' });
    }
    return new AIMessage({
      id,
      content: '',
      tool_calls: [
        {
          id: `information-${randomUUID()}`,
          name: 'get_my_information',
          args: {
            sections: ['try_on_tasks'],
            page: content.includes('空页') ? 10 : 1,
            ...(content.includes('筛选失败任务')
              ? { tryOnStatus: 'failed' }
              : {}),
          },
        },
      ],
    });
  }

  public override async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    const message = this.decide(messages);
    return {
      generations: [{ message, text: String(message.content) }],
    };
  }

  public override async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
  ): AsyncGenerator<ChatGenerationChunk> {
    const result = this.decide(messages);
    const calls = result.tool_calls ?? [];
    const message = new AIMessageChunk({
      ...(result.id ? { id: result.id } : {}),
      content: String(result.content),
      ...(calls.length
        ? {
            tool_call_chunks: calls.map((call, index) => ({
              type: 'tool_call_chunk' as const,
              index,
              id: call.id!,
              name: call.name,
              args: JSON.stringify(call.args),
            })),
          }
        : {}),
    });
    yield new ChatGenerationChunk({
      message,
      text: String(message.content),
    });
  }
}

type Frame = { type: string; data: Record<string, unknown> };

function parseFrame(frame: string): Frame {
  const lines = frame.split('\n');
  const event = lines.find((line) => line.startsWith('event: '));
  const data = lines.find((line) => line.startsWith('data: '));
  assert.ok(event);
  assert.ok(data);
  return {
    type: event.slice(7),
    data: JSON.parse(data.slice(6)) as Record<string, unknown>,
  };
}

test(
  '隔离 PostgreSQL：本人试穿元数据快照、JWT 工具图、JSON/SSE 和记忆来源隔离',
  {
    skip: process.env.RUN_CHAT_TRY_ON_INFORMATION_POSTGRES_TEST !== '1',
    timeout: 120_000,
  },
  async (t) => {
    const dbName = process.env.CHAT_TRY_ON_INFORMATION_TEST_DB ?? '';
    assert.match(
      dbName,
      /^clothes_guide_chat_try_on_information_test_[a-z0-9_]+$/u,
      '必须显式指定本轮新建的具名可销毁试穿信息测试库',
    );
    assert.notEqual(dbName, config.dbName);
    assert.notEqual(dbName, 'clothes_guide');
    const queries: string[] = [];
    let afterTaskLoaded:
      | ((transaction: EntityManager) => Promise<void>)
      | undefined;
    // 只在快照用例中于真实任务读取后提交并发变更，不替换 reader 的数据库调用。
    const orm = await MikroORM.init({
      ...config,
      dbName,
      debug: ['query'],
      logger: (message) => queries.push(message),
      migrations: { ...config.migrations, snapshot: false },
      subscribers: [
        {
          async onLoad(args: EventArgs<TryOnTask>) {
            if (!(args.entity instanceof TryOnTask) || !afterTaskLoaded) return;
            const hook = afterTaskLoaded;
            afterTaskLoaded = undefined;
            await hook(args.em);
          },
        },
      ],
    });
    let app: INestApplication | undefined;
    const ownerId = randomUUID();
    const strangerId = randomUUID();
    const fixtureUsers = [ownerId, strangerId];
    let migrated = false;
    try {
      // 目标库必须由调用方先核实并创建；这里仅应用既有增量迁移，不建库或删库。
      await orm.migrator.up();
      migrated = true;
      const em = orm.em.fork();
      const owner = Object.assign(new User(), {
        id: ownerId,
        email: `${ownerId}@local.invalid`,
        passwordHash: 'non-login-fixture',
        displayName: '试穿信息测试',
      });
      const stranger = Object.assign(new User(), {
        id: strangerId,
        email: `${strangerId}@local.invalid`,
        passwordHash: 'non-login-fixture',
        displayName: '试穿隔离测试',
      });
      await em.persist([owner, stranger]).flush();
      const createdAt = new Date('2026-11-13T00:00:00.000Z');
      const makeTask = (
        status: TryOnTaskStatus,
        userId = ownerId,
        deletedAt: Date | null = null,
      ) =>
        Object.assign(new TryOnTask(), {
          userId,
          status,
          productExternalId: `test-${randomUUID()}`,
          productName: '合成衬衫',
          productCategory: 'tops',
          color: '白色',
          garmentImageUrl: `https://local.invalid/${PRIVATE_VALUE}`,
          garmentImageObjectKey: `${PRIVATE_VALUE}/garment`,
          sourcePhotoId: null,
          consentVersion: 'synthetic-test-only',
          failureCode: PRIVATE_VALUE,
          providerModel: PRIVATE_VALUE,
          providerRequestId: PRIVATE_VALUE,
          completedAt:
            status === TryOnTaskStatus.SUCCEEDED ||
            status === TryOnTaskStatus.FAILED
              ? createdAt
              : null,
          createdAt,
          deletedAt,
        });
      const tasks = [
        TryOnTaskStatus.QUEUED,
        TryOnTaskStatus.FAILED,
        TryOnTaskStatus.FAILED,
        TryOnTaskStatus.SUCCEEDED,
        TryOnTaskStatus.SUCCEEDED,
        TryOnTaskStatus.SUCCEEDED,
        TryOnTaskStatus.SUCCEEDED,
        TryOnTaskStatus.FAILED,
      ].map((status) => makeTask(status));
      const excluded = [
        makeTask(TryOnTaskStatus.DELETED),
        makeTask(TryOnTaskStatus.SUCCEEDED, ownerId, createdAt),
        makeTask(TryOnTaskStatus.SUCCEEDED, strangerId),
      ];
      await em.persist([...tasks, ...excluded]).flush();
      const succeeded = tasks.filter(
        (task) => task.status === TryOnTaskStatus.SUCCEEDED,
      );
      const makeResult = (
        task: TryOnTask,
        userId = ownerId,
        deletedAt: Date | null = null,
      ) =>
        Object.assign(new TryOnResult(), {
          taskId: task.id,
          userId,
          objectKey: `${PRIVATE_VALUE}/${randomUUID()}`,
          mimeType: 'image/png',
          byteSize: 123,
          width: 32,
          height: 32,
          deletedAt,
        });
      const validResult = makeResult(succeeded[0]!);
      const deletedResult = makeResult(succeeded[2]!, ownerId, createdAt);
      const strangerResult = makeResult(succeeded[3]!, strangerId);
      const queuedResult = makeResult(tasks[0]!);
      await em
        .persist([
          validResult,
          deletedResult,
          strangerResult,
          queuedResult,
          makeResult(excluded[2]!, strangerId),
        ])
        .flush();
      const reader = new TryOnTaskReaderService(em.getRepository(TryOnTask));
      const taskSnapshot = () =>
        orm.em.fork().find(
          TryOnTask,
          {
            userId: { $in: fixtureUsers },
          },
          { orderBy: { id: 'asc' } },
        );
      const resultSnapshot = () =>
        orm.em.fork().find(
          TryOnResult,
          {
            userId: { $in: fixtureUsers },
          },
          { orderBy: { id: 'asc' } },
        );

      await t.test('真实分页、四状态、双重删除和结果归属边界', async () => {
        const first = await reader.listMetadataForUser(ownerId, { page: 1 });
        const second = await reader.listMetadataForUser(ownerId, { page: 2 });
        assert.equal(first.total, tasks.length);
        assert.equal(first.pageSize, 5);
        assert.equal(first.items.length, 5);
        assert.equal(second.items.length, 3);
        const all = [...first.items, ...second.items];
        assert.deepEqual(
          all.map((item) => item.taskId),
          tasks
            .map((task) => task.id)
            .sort()
            .reverse(),
        );
        for (const item of all) {
          assert.deepEqual(
            Object.keys(item).sort(),
            [
              'taskId',
              'status',
              'product',
              'createdAt',
              'completedAt',
              'resultAvailable',
            ].sort(),
          );
          assert.deepEqual(
            Object.keys(item.product).sort(),
            ['externalId', 'name', 'category', 'color'].sort(),
          );
          assert.equal(
            item.resultAvailable,
            item.taskId === validResult.taskId,
          );
        }
        assert.equal(JSON.stringify(all).includes(PRIVATE_VALUE), false);
        assert.equal(JSON.stringify(all).includes(validResult.id), false);
        for (const status of [
          TryOnTaskStatus.QUEUED,
          TryOnTaskStatus.PROCESSING,
          TryOnTaskStatus.SUCCEEDED,
          TryOnTaskStatus.FAILED,
        ] as const) {
          // 保留同用户仅一个活动任务的真实约束，串行切换该任务覆盖 processing。
          if (status === TryOnTaskStatus.PROCESSING) {
            await orm.em
              .fork()
              .nativeUpdate(
                TryOnTask,
                { id: tasks[0]!.id },
                { status: TryOnTaskStatus.PROCESSING },
              );
          }
          try {
            const page = await reader.listMetadataForUser(ownerId, {
              page: 1,
              status,
            });
            assert.equal(
              page.total,
              status === TryOnTaskStatus.PROCESSING
                ? 1
                : tasks.filter((task) => task.status === status).length,
            );
            assert.equal(
              page.items.every((item) => item.status === status),
              true,
            );
          } finally {
            if (status === TryOnTaskStatus.PROCESSING) {
              await orm.em
                .fork()
                .nativeUpdate(
                  TryOnTask,
                  { id: tasks[0]!.id },
                  { status: TryOnTaskStatus.QUEUED },
                );
            }
          }
        }
        assert.deepEqual(
          await reader.listMetadataForUser(ownerId, { page: 10 }),
          { items: [], page: 10, pageSize: 5, total: tasks.length },
        );
        const other = await reader.listMetadataForUser(strangerId, { page: 1 });
        assert.deepEqual(
          other.items.map((item) => item.taskId),
          [excluded[2]!.id],
        );
        assert.equal(other.items[0]?.resultAvailable, true);
      });

      await t.test('真实只读一致性快照、批量结果查询和无领域写入', async () => {
        const beforeTasks = JSON.stringify(await taskSnapshot());
        const beforeResults = JSON.stringify(await resultSnapshot());
        queries.length = 0;
        await reader.listMetadataForUser(ownerId, { page: 1 });
        const reads = queries.filter((query) => /\bselect\b/iu.test(query));
        const taskReads = reads.filter((query) =>
          query.includes('"try_on_tasks"'),
        );
        const resultReads = reads.filter((query) =>
          query.includes('"try_on_results"'),
        );
        assert.equal(taskReads.length, 2);
        assert.equal(resultReads.length, 1);
        assert.match(taskReads.join('\n'), /"created_at" desc, .*"id" desc/iu);
        assert.match(resultReads[0]!, /"task_id" in \(/iu);
        assert.doesNotMatch(
          reads.join('\n'),
          /"object_key"|"garment_image_url"|"source_photo_id"|"provider_model"/u,
        );
        assert.equal(JSON.stringify(await taskSnapshot()), beforeTasks);
        assert.equal(JSON.stringify(await resultSnapshot()), beforeResults);
        queries.length = 0;
        await reader.listMetadataForUser(ownerId, { page: 10 });
        assert.equal(
          queries.some((query) => query.includes('from "try_on_results"')),
          false,
        );
        const concurrentTask = makeTask(TryOnTaskStatus.FAILED);
        let settingsChecked = false;
        afterTaskLoaded = async (transaction) => {
          const settings = await transaction
            .getConnection()
            .execute<Array<{ isolation: string; readonly: string }>>(
              "select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as readonly",
              [],
              'all',
              transaction.getTransactionContext(),
            );
          assert.equal(settings[0]?.isolation, 'repeatable read');
          assert.equal(settings[0]?.readonly, 'on');
          settingsChecked = true;
          await orm.em.fork().nativeUpdate(
            TryOnResult,
            { id: validResult.id },
            {
              deletedAt: new Date(),
            },
          );
          await orm.em.fork().persist(concurrentTask).flush();
        };
        try {
          const original = await reader.listMetadataForUser(ownerId, {
            page: 1,
            status: TryOnTaskStatus.SUCCEEDED,
          });
          assert.equal(settingsChecked, true);
          assert.equal(original.total, succeeded.length);
          assert.equal(
            original.items.find((item) => item.taskId === validResult.taskId)
              ?.resultAvailable,
            true,
          );
          const next = await reader.listMetadataForUser(ownerId, {
            page: 1,
            status: TryOnTaskStatus.SUCCEEDED,
          });
          assert.equal(
            next.items.find((item) => item.taskId === validResult.taskId)
              ?.resultAvailable,
            false,
          );
          assert.equal(
            (await reader.listMetadataForUser(ownerId, { page: 1 })).total,
            tasks.length + 1,
          );
        } finally {
          afterTaskLoaded = undefined;
          await orm.em.fork().nativeUpdate(
            TryOnResult,
            { id: validResult.id },
            {
              deletedAt: null,
            },
          );
          await orm.em
            .fork()
            .nativeDelete(TryOnTask, { id: concurrentTask.id });
        }
      });

      const llmConfig = new ConfigService({
        LLM_MODEL: 'try-on-information-fake',
        LLM_CONTEXT_WINDOW_TOKENS: '65536',
        LLM_TOKEN_ENCODING: 'cl100k_base',
      });
      const model = new TryOnInformationModel();
      const llm = new LlmService(createLlmGraph(model), llmConfig, (tools) =>
        createLlmGraph(model, tools),
      );
      const users = new UsersService(em.getRepository(User));
      const source = new ChatExtractionSourceService(
        em.getRepository(ChatConversation),
        users,
      );
      const memoryTasks = new UserMemoryTaskService(
        em.getRepository(UserMemoryTask),
        source,
      );
      let enqueued = 0;
      let unavailable = false;
      let unrelatedReads = 0;
      const information = new ChatUserInformationService(
        {
          listForUser: async () => {
            unrelatedReads++;
            throw new Error('address reader must not be called');
          },
        } as never,
        {
          listForUser: async () => {
            unrelatedReads++;
            throw new Error('order reader must not be called');
          },
        } as never,
        {
          listSavedMetadataForUser: async () => {
            unrelatedReads++;
            throw new Error('photo reader must not be called');
          },
        } as never,
        {
          listMetadataForUser: async (
            ...args: Parameters<TryOnTaskReaderService['listMetadataForUser']>
          ) => {
            if (unavailable) throw new Error(PRIVATE_VALUE);
            return reader.listMetadataForUser(...args);
          },
        } as never,
      );
      const traces = em.getRepository(ChatTraceEvent);
      const display = new ChatDisplayService(traces, {
        getTryOnProducts: async () => new Map(),
      } as never);
      const inactivePurchase = {
        fingerprint: '',
        active: false,
        context: '',
        reference: null,
      };
      const chat = new ChatRecordsService(
        em.getRepository(ChatConversation),
        em.getRepository(ChatMessage),
        traces,
        llm,
        new ChatContextService(llmConfig, llm),
        { summarize: async () => null } as never,
        new ChatTraceWriterService(traces),
        { readContext: async () => '' },
        {
          enqueueInTransaction: async (transaction, input) => {
            enqueued++;
            await memoryTasks.enqueueInTransaction(transaction, input);
          },
        },
        { markConversationDeleted: async () => undefined },
        display,
        {
          readContext: async () => '',
          listForChat: async () => {
            throw new Error('首期试穿测试不应读取偏好明细');
          },
        },
        {} as never,
        {
          runState: async () => inactivePurchase,
          runStateInTransaction: async () => inactivePurchase,
        } as never,
        new ChatConversationAccess(),
        {} as never,
        undefined,
        undefined,
        undefined,
        information,
      );
      for (const controller of [LlmChatController, ChatRecordsController]) {
        Reflect.defineMetadata(
          'design:paramtypes',
          [ChatRecordsService],
          controller,
        );
      }
      @Module({
        controllers: [LlmChatController, ChatRecordsController],
        providers: [{ provide: ChatRecordsService, useValue: chat }],
      })
      class TryOnInformationHttpFixture {}
      app = await NestFactory.create(TryOnInformationHttpFixture, {
        logger: false,
        abortOnError: false,
      });
      // 各请求串行使用独立 identity map，模拟生产请求边界而不放宽业务断言。
      app.use((_request: unknown, _response: unknown, next: () => void) => {
        em.clear();
        next();
      });
      const jwt = new JwtService({ secret: 'try-on-information-test-only' });
      app.useGlobalGuards(new JwtAuthGuard(jwt, new Reflector(), users));
      app.useGlobalPipes(new StandardSchemaValidationPipe());
      app.setGlobalPrefix('api');
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const token = await jwt.signAsync({ sub: ownerId });
      const strangerToken = await jwt.signAsync({ sub: strangerId });
      const request = (
        path: string,
        body?: unknown,
        bearer: string | null = token,
      ) =>
        fetch(`${base}/api${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'content-type': 'application/json',
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(20_000),
        });
      const body = (content: string, conversationId?: string) => ({
        ...(conversationId ? { conversationId } : {}),
        messages: [{ role: 'user', content }],
      });
      const excludedTurns: Array<{
        conversationId: string;
        userMessageId: string;
        assistantMessageId: string;
      }> = [];
      let resumeConversationId = '';
      const assertPersisted = async (conversationId: string) => {
        const messages = await orm.em.fork().find(ChatMessage, {
          conversationId,
        });
        assert.equal(messages.length, 2);
        assert.equal(
          messages.every((message) => !message.memoryExtractionEligible),
          true,
        );
        assert.equal(
          await orm.em.fork().count(UserMemoryTask, { conversationId }),
          0,
        );
        const userMessage = messages.find(
          (message) => message.role === 'user',
        )!;
        const assistant = messages.find(
          (message) => message.role === 'assistant',
        )!;
        excludedTurns.push({
          conversationId,
          userMessageId: userMessage.id,
          assistantMessageId: assistant.id,
        });
        const rows = await orm.em.fork().find(
          ChatTraceEvent,
          { conversationId },
          {
            orderBy: { sequence: 'asc' },
          },
        );
        assert.deepEqual(
          rows.map((row) => row.eventType),
          [
            'input',
            'model_response',
            'tool_call',
            'tool_result',
            'model_response',
          ],
        );
        const toolResult = rows.find(
          (row) => row.eventType === ChatTraceEventType.TOOL_RESULT,
        )!;
        const serialized = JSON.stringify(rows);
        assert.equal(serialized.includes(PRIVATE_VALUE), false);
        for (const task of [...tasks, ...excluded]) {
          assert.equal(serialized.includes(task.id), false);
          assert.equal(serialized.includes(task.productExternalId), false);
        }
        assert.equal(JSON.stringify(toolResult).includes('合成衬衫'), false);
        const final = rows.at(-1)!;
        const envelope = (final.payload as Record<string, unknown>)
          .publicDisplay as PublicDisplayEnvelope;
        assert.equal(envelope.assistantMessageId, assistant.id);
        assert.notEqual(final.messageId, assistant.id);
        assert.equal(envelope.cards.length, 0);
        assert.equal(envelope.forms?.length ?? 0, 0);
        for (const activity of envelope.activities) {
          if (activity.type === 'tool') {
            assert.equal(activity.input, null);
            assert.equal(activity.output, null);
          }
        }
        assert.equal(
          mapTraceEventsToMessages(rows).some(
            ({ message }) => message instanceof ToolMessage,
          ),
          false,
        );
        assert.equal(eligibleSummaryTraceIds(rows, messages).size, 0);
        return rows;
      };

      await t.test(
        'JWT 身份、未知 HTTP 字段和会话越权在开流前拒绝',
        async () => {
          assert.equal(
            (await request('/llm/chat', body('查询试穿'), null)).status,
            401,
          );
          assert.equal(
            (
              await request('/llm/chat/stream', {
                ...body('查询试穿'),
                userId: strangerId,
              })
            ).status,
            400,
          );
          const conversation = Object.assign(new ChatConversation(), {
            userId: ownerId,
            title: 'JWT 归属 fixture',
          });
          await orm.em.fork().persist(conversation).flush();
          assert.equal(
            (
              await request(
                '/llm/chat/stream',
                body('查询试穿', conversation.id),
                strangerToken,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await request(
                `/chat/conversations/${conversation.id}`,
                undefined,
                strangerToken,
              )
            ).status,
            404,
          );
          await orm.em
            .fork()
            .nativeUpdate(
              User,
              { id: strangerId },
              { status: UserStatus.DISABLED },
            );
          assert.equal(
            (await request('/llm/chat', body('查询试穿'), strangerToken))
              .status,
            401,
          );
        },
      );

      await t.test(
        'JSON 成功、空页、查询失败都隔离整轮，安全结果反馈给实际工具图',
        async () => {
          for (const mode of ['成功', '空页', '查询故障'] as const) {
            unavailable = mode === '查询故障';
            const callCount = model.calls.length;
            const response = await request(
              '/llm/chat',
              body(`查询试穿${mode}`),
            );
            assert.equal(response.status, 201);
            const output = (await response.json()) as {
              conversationId: string;
              content: string;
              cards: unknown[];
            };
            assert.equal(output.content, '已查询，请到我的试穿查看。');
            assert.equal(output.cards.length, 0);
            await assertPersisted(output.conversationId);
            const toolMessage = model.calls
              .slice(callCount)
              .flat()
              .find((message) => message instanceof ToolMessage);
            assert.ok(toolMessage instanceof ToolMessage);
            const result = JSON.parse(String(toolMessage.content)) as {
              ok: boolean;
              sections: {
                try_on_tasks?: {
                  items: Array<{ taskId: string }>;
                  total: number;
                };
              };
              errors: unknown[];
            };
            assert.equal(result.ok, true);
            assert.equal(JSON.stringify(result).includes(PRIVATE_VALUE), false);
            if (mode === '查询故障') {
              assert.deepEqual(result, {
                ok: true,
                sections: {},
                errors: [{ section: 'try_on_tasks', code: 'unavailable' }],
              });
            } else {
              assert.equal(result.sections.try_on_tasks?.total, tasks.length);
              assert.equal(
                result.sections.try_on_tasks?.items.length,
                mode === '空页' ? 0 : 5,
              );
            }
            if (mode === '成功') resumeConversationId = output.conversationId;
            assert.equal(enqueued, 0);
          }
          unavailable = false;
        },
      );

      await t.test(
        'SSE 成功、空页、故障均在消息与最终绑定提交后发送 done',
        async () => {
          for (const mode of ['成功', '空页', '查询故障'] as const) {
            unavailable = mode === '查询故障';
            const response = await request(
              '/llm/chat/stream',
              body(`查询试穿${mode}`),
            );
            assert.equal(response.status, 200);
            assert.match(
              response.headers.get('content-type') ?? '',
              /text\/event-stream/u,
            );
            assert.ok(response.body);
            const stream = response.body.getReader();
            const decoder = new TextDecoder();
            const frames: Frame[] = [];
            let pending = '';
            while (true) {
              const chunk = await stream.read();
              pending += decoder.decode(chunk.value, { stream: !chunk.done });
              let end: number;
              while ((end = pending.indexOf('\n\n')) !== -1) {
                const frame = parseFrame(pending.slice(0, end));
                pending = pending.slice(end + 2);
                frames.push(frame);
                if (frame.type === 'done') {
                  assert.equal(typeof frame.data.conversationId, 'string');
                  // 收到 done 当下用另一连接读取，消息和 publicDisplay 已对外可见。
                  await assertPersisted(frame.data.conversationId as string);
                }
              }
              if (chunk.done) break;
            }
            assert.equal(pending, '');
            assert.equal(frames[0]?.type, 'start');
            assert.equal(frames.at(-1)?.type, 'done');
            assert.equal(
              frames.some((frame) =>
                [
                  'error',
                  'card',
                  'form',
                  'purchase-form',
                  'try-on-status',
                ].includes(frame.type),
              ),
              false,
            );
            for (const frame of frames.filter(
              (item) => item.type === 'activity',
            )) {
              const activity = frame.data.activity as {
                input: unknown;
                output: unknown;
              };
              assert.equal(activity.input, null);
              assert.equal(activity.output, null);
            }
            assert.equal(JSON.stringify(frames).includes(PRIVATE_VALUE), false);
            assert.equal(enqueued, 0);
          }
          unavailable = false;
          assert.equal(unrelatedReads, 0);
        },
      );

      await t.test(
        '下一普通轮恢复入队，旧工具历史隐藏且混合来源与摘要仍排除试穿轮',
        async () => {
          const callCount = model.calls.length;
          const response = await request(
            '/llm/chat',
            body('普通聊天：我喜欢舒适面料', resumeConversationId),
          );
          assert.equal(response.status, 201);
          await response.json();
          assert.equal(enqueued, 1);
          const newCalls = model.calls.slice(callCount);
          assert.equal(newCalls.length, 1);
          assert.equal(
            newCalls[0]?.some((message) => message instanceof ToolMessage),
            false,
          );
          assert.equal(
            newCalls[0]?.some(
              (message) =>
                message instanceof AIMessage &&
                message.tool_calls?.some(
                  (call) => call.name === 'get_my_information',
                ),
            ),
            false,
          );
          const messages = await orm.em.fork().find(
            ChatMessage,
            { conversationId: resumeConversationId },
            {
              orderBy: { createdAt: 'asc' },
            },
          );
          assert.equal(messages.length, 4);
          const eligible = messages.filter(
            (message) => message.memoryExtractionEligible,
          );
          assert.equal(eligible.length, 2);
          const user = eligible.find((message) => message.role === 'user')!;
          const assistant = eligible.find(
            (message) => message.role === 'assistant',
          )!;
          const ordinaryTurn = {
            userMessageId: user.id,
            assistantMessageId: assistant.id,
          };
          const excludedTurn = excludedTurns.find(
            (turn) => turn.conversationId === resumeConversationId,
          )!;
          assert.equal(
            await source.readTurn({ userId: ownerId, ...excludedTurn }),
            null,
          );
          const mixed = await source.readTurns({
            userId: ownerId,
            conversationId: resumeConversationId,
            turns: [excludedTurn, ordinaryTurn],
          });
          assert.deepEqual(
            mixed?.map((turn) => turn.userMessageId),
            [user.id],
          );
          // 旧候选重试重新读取同一来源时，不能绕过消息资格重新引入试穿轮次。
          assert.equal(
            await source.readTurn({ userId: ownerId, ...excludedTurn }),
            null,
          );
          const queued = await orm.em
            .fork()
            .find(UserMemoryTask, { conversationId: resumeConversationId });
          assert.equal(queued.length, 1);
          assert.deepEqual(queued[0]?.sourceTurns, [ordinaryTurn]);
          const rows = await orm.em.fork().find(
            ChatTraceEvent,
            { conversationId: resumeConversationId },
            {
              orderBy: { createdAt: 'asc', sequence: 'asc' },
            },
          );
          const allowed = eligibleSummaryTraceIds(rows, messages);
          assert.ok(allowed.size > 0);
          const oldRows = rows.filter(
            (row) =>
              (
                row.payload as {
                  publicDisplay?: { assistantMessageId?: string };
                } | null
              )?.publicDisplay?.assistantMessageId ===
              excludedTurn.assistantMessageId,
          );
          assert.equal(oldRows.length, 1);
          for (const row of rows.filter(
            (row) => row.runId === oldRows[0]!.runId,
          )) {
            assert.equal(
              allowed.has(
                `${row.runId}:${row.messageId ?? `trace-${row.sequence}`}`,
              ),
              false,
            );
          }
          const history = await request(
            `/chat/conversations/${resumeConversationId}?page=1&pageSize=20`,
          );
          assert.equal(history.status, 200);
          const output = (await history.json()) as ConversationDetailResponse;
          assert.equal(output.messages.items.length, 4);
          assert.equal(JSON.stringify(output).includes(PRIVATE_VALUE), false);
          for (const task of tasks)
            assert.equal(JSON.stringify(output).includes(task.id), false);
        },
      );
      t.diagnostic(
        '测试模块仅注册聊天 Controller 与手动查询实例；未启动 Worker、调度器、对象存储或真实模型',
      );
    } finally {
      afterTaskLoaded = undefined;
      try {
        await app?.close();
      } finally {
        try {
          if (migrated) {
            await orm.em.fork().transactional(async (cleanup) => {
              const conversations = await cleanup.find(ChatConversation, {
                userId: { $in: fixtureUsers },
              });
              const conversationIds = conversations.map((row) => row.id);
              if (conversationIds.length) {
                await cleanup.nativeDelete(UserMemoryTask, {
                  conversationId: { $in: conversationIds },
                });
                await cleanup.nativeDelete(ChatTraceEvent, {
                  conversationId: { $in: conversationIds },
                });
                await cleanup.nativeDelete(ChatMessage, {
                  conversationId: { $in: conversationIds },
                });
                await cleanup.nativeDelete(ChatConversation, {
                  id: { $in: conversationIds },
                });
              }
              await cleanup.nativeDelete(TryOnResult, {
                userId: { $in: fixtureUsers },
              });
              await cleanup.nativeDelete(TryOnTask, {
                userId: { $in: fixtureUsers },
              });
              await cleanup.nativeDelete(User, { id: { $in: fixtureUsers } });
            });
          }
        } finally {
          await orm.close();
        }
      }
    }
  },
);
