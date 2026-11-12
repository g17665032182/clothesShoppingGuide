import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DriverException } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';

import config from '../../mikro-orm.config.js';
import { User } from '../../users/entity/user.entity.js';
import { ChatDisplayService } from '../display/chat-display.service.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import {
  ChatMessage,
  ChatRecordMessageRole,
} from '../entity/chat-message.entity.js';
import {
  ChatTraceEvent,
  ChatTraceEventType,
} from '../entity/chat-trace-event.entity.js';

test(
  '本地 PostgreSQL：公开展示 JSON 页内查询、真实行锁及消息事务回滚',
  {
    // 默认测试不依赖数据库；仅显式本地联调时启用，并只清理本次创建的 UUID。
    skip: process.env.RUN_CHAT_DISPLAY_POSTGRES_SMOKE !== '1',
    timeout: 60_000,
  },
  async (t) => {
    const dbName = config.dbName ?? '';
    assert.match(
      dbName,
      /^clothes_guide_chat_display_test_[a-z0-9_]+$/u,
      '必须通过 DB_NAME 显式指定具名可销毁测试库',
    );
    assert.notEqual(dbName, 'clothes_guide');
    const queries: string[] = [];
    const entities = [User, ChatConversation, ChatMessage, ChatTraceEvent];
    const orm = await MikroORM.init({
      ...config,
      entities,
      entitiesTs: entities,
      debug: ['query'],
      logger: (message) => queries.push(message),
    });
    const ownerId = randomUUID();
    const conversationId = randomUUID();
    const em = orm.em.fork();
    const display = new ChatDisplayService(em.getRepository(ChatTraceEvent), {
      getTryOnProducts: async () => new Map(),
    } as never);
    const firstMessageId = randomUUID();
    const secondMessageId = randomUUID();
    const rollbackMessageId = randomUUID();
    const runIds = [randomUUID(), randomUUID(), randomUUID()];
    const makeTrace = (runId: string, sequence: number) =>
      Object.assign(new ChatTraceEvent(), {
        conversationId,
        runId,
        sequence,
        eventType: ChatTraceEventType.MODEL_RESPONSE,
        messageId: `langchain-${runId}-${sequence}`,
        content: 'smoke fixture',
        payload: { toolCalls: [] },
      });
    const makeMessage = (id: string) =>
      Object.assign(new ChatMessage(), {
        id,
        conversationId,
        role: ChatRecordMessageRole.ASSISTANT,
        content: 'smoke fixture',
      });
    try {
      await em
        .persist(
          Object.assign(new User(), {
            id: ownerId,
            email: `display-smoke-${ownerId}@local.invalid`,
            passwordHash: 'non-login-smoke-fixture',
            displayName: 'display smoke fixture',
          }),
        )
        .flush();
      await em
        .persist(
          Object.assign(new ChatConversation(), {
            id: conversationId,
            userId: ownerId,
            title: 'display smoke fixture',
          }),
        )
        .flush();
      em.persist(runIds.map((runId) => makeTrace(runId, 1)));
      // 同一会话加入两千条原始 trace，验证分页查询不把整段历史带回进程。
      const sampleRunId = randomUUID();
      for (let sequence = 0; sequence < 2_000; sequence += 1) {
        em.persist(makeTrace(sampleRunId, sequence));
      }
      await em.flush();

      for (const [index, assistantMessageId] of [
        firstMessageId,
        secondMessageId,
      ].entries()) {
        await em.transactional(async (transaction) => {
          transaction.persist(makeMessage(assistantMessageId));
          await display.bind(transaction, {
            conversationId,
            runId: runIds[index]!,
            sequence: 1,
            assistantMessageId,
            data: display.create(8_000),
          });
        });
      }
      queries.length = 0;
      const restored = await display.read(conversationId, [firstMessageId]);
      assert.deepEqual([...restored.keys()], [firstMessageId]);
      const reads = queries.filter((query) =>
        query.includes(`->'publicDisplay'->>'assistantMessageId'`),
      );
      assert.equal(reads.length, 1);
      assert.match(reads[0]!, /"id".*"run_id".*"sequence".*"payload"/u);
      assert.match(reads[0]!, / in \(/u);
      assert.doesNotMatch(reads[0]!, /select "[^"]+"\.\*/u);

      const query = em
        .createQueryBuilder(ChatTraceEvent)
        .select(['id', 'runId', 'sequence', 'payload'])
        .where({
          conversationId,
          eventType: ChatTraceEventType.MODEL_RESPONSE,
          payload: {
            publicDisplay: {
              assistantMessageId: { $in: [firstMessageId] },
            },
          },
        });
      const explained = await em.getConnection().execute<
        Array<{
          'QUERY PLAN': Array<{
            Plan: {
              'Actual Rows': number;
              'Node Type': string;
              'Rows Removed by Filter'?: number;
            };
            'Execution Time': number;
          }>;
        }>
      >(`explain (analyze, buffers, format json) ${query.getQuery()}`, query.getParams());
      const explanation = explained[0]?.['QUERY PLAN'][0];
      assert.equal(explanation?.Plan['Actual Rows'], 1);
      t.diagnostic('2003 条 trace 样本：单次 JSON 过滤只返回当前页的 1 条绑定');
      t.diagnostic(
        `EXPLAIN ${explanation?.Plan['Node Type']}，过滤 ${explanation?.Plan['Rows Removed by Filter'] ?? 0} 行，执行 ${explanation?.['Execution Time']}ms`,
      );

      const bound = await orm.em.fork().findOneOrFail(ChatTraceEvent, {
        conversationId,
        runId: runIds[0]!,
        sequence: 1,
      });
      assert.equal(bound.messageId, `langchain-${runIds[0]}-1`);
      assert.deepEqual(
        (bound.payload as Record<string, unknown>).toolCalls,
        [],
      );

      await em.transactional(async (transaction) => {
        await display.bind(transaction, {
          conversationId,
          runId: runIds[0]!,
          sequence: 1,
          assistantMessageId: firstMessageId,
          data: display.create(8_000),
        });
        await assert.rejects(
          orm.em.fork().transactional(async (contender) => {
            await contender
              .getConnection()
              .execute(
                "set local lock_timeout = '150ms'",
                [],
                'run',
                contender.getTransactionContext(),
              );
            await display.bind(contender, {
              conversationId,
              runId: runIds[0]!,
              sequence: 1,
              assistantMessageId: firstMessageId,
              data: display.create(8_000),
            });
          }),
          (error: unknown) =>
            error instanceof DriverException && error.code === '55P03',
        );
      });
      t.diagnostic('独立事务竞争同一最终 trace 时触发真实行锁等待超时');

      await assert.rejects(
        em.transactional(async (transaction) => {
          transaction.persist(makeMessage(rollbackMessageId));
          await transaction.flush();
          await display.bind(transaction, {
            conversationId,
            runId: runIds[2]!,
            sequence: 1,
            assistantMessageId: rollbackMessageId,
            data: display.create(8_000),
          });
          throw new Error('intentional display smoke rollback');
        }),
        /intentional display smoke rollback/u,
      );
      const fresh = orm.em.fork();
      assert.equal(
        await fresh.count(ChatMessage, { id: rollbackMessageId }),
        0,
      );
      const rolledBackTrace = await fresh.findOneOrFail(ChatTraceEvent, {
        conversationId,
        runId: runIds[2]!,
        sequence: 1,
      });
      assert.deepEqual(rolledBackTrace.payload, { toolCalls: [] });
      t.diagnostic('展示消息与 publicDisplay 同时回滚，既有内部 trace 保留');
    } finally {
      const cleanup = orm.em.fork();
      try {
        await cleanup.transactional(async (transaction) => {
          await transaction.nativeDelete(ChatTraceEvent, { conversationId });
          await transaction.nativeDelete(ChatMessage, { conversationId });
          await transaction.nativeDelete(ChatConversation, {
            id: conversationId,
          });
          await transaction.nativeDelete(User, { id: ownerId });
        });
      } finally {
        await orm.close();
      }
    }
  },
);
