import assert from 'node:assert/strict';
import test from 'node:test';

import { memoryCandidateSchema } from '../context/memory-candidate.schema.js';
import { memoryDocumentOperationsSchema } from '../context/memory-document-patch.schema.js';
import { UserMemoryExtractorService } from '../service/user-memory-extractor.service.js';
import { UserMemoryTaskService } from '../service/user-memory-task.service.js';
import { UserMemoryTaskStatus } from '../entity/user-memory-task.entity.js';

test('记忆关闭时不读取聊天原文也不调用提取模型', async () => {
  let chatRead = false;
  let modelCalled = false;
  const service = new UserMemoryExtractorService(
    {
      async generate() {
        modelCalled = true;
        return { content: '{"operations":[]}' };
      },
    } as never,
    {
      getEntityManager() {
        return {
          fork() {
            chatRead = true;
            throw new Error('禁用时不应读取聊天消息');
          },
        };
      },
    } as never,
    {} as never,
    {
      findOne: async () => ({ enabled: false }),
    } as never,
    {} as never,
  );

  await service.process({
    id: 'task-1',
    userId: 'user-1',
    conversationId: 'conversation-1',
    userMessageId: 'user-message-1',
    assistantMessageId: 'assistant-message-1',
    status: UserMemoryTaskStatus.PROCESSING,
  } as never);

  assert.equal(chatRead, false);
  assert.equal(modelCalled, false);
});

test('候选支持文档补丁并拒绝敏感信息和未知字段', () => {
  const candidate = memoryCandidateSchema.parse({
    operations: [],
    documentOperations: [
      {
        operation: 'append',
        section: 'clothing',
        markdown: '偏好天然棉质面料',
        explicit: true,
      },
    ],
  });
  assert.equal(candidate.documentOperations.length, 1);
  assert.throws(() =>
    memoryDocumentOperationsSchema.parse([
      {
        operation: 'append',
        section: 'other',
        markdown: '我的手机号是 13812345678',
        explicit: true,
      },
    ]),
  );
  assert.throws(() =>
    memoryCandidateSchema.parse({
      operations: [],
      documentOperations: [],
      fullDocument: '# 覆盖文档',
    }),
  );
});

test('提取时提供当前文档并传递任务代次应用文档操作', async () => {
  let generatedInput = '';
  let appliedInput: Record<string, unknown> | undefined;
  const service = new UserMemoryExtractorService(
    {
      async generate(input: { user: string }) {
        generatedInput = input.user;
        return {
          content: JSON.stringify({
            operations: [],
            documentOperations: [
              {
                operation: 'append',
                section: 'clothing',
                markdown: '偏好耐穿的基础款',
                explicit: true,
              },
            ],
          }),
        };
      },
    } as never,
    {
      getEntityManager() {
        return {
          fork() {
            return {
              getConnection() {
                return {
                  async execute() {
                    return [
                      {
                        user_content: '我长期偏好耐穿的基础款',
                        assistant_content: '我会记住这个长期偏好。',
                      },
                    ];
                  },
                };
              },
              getTransactionContext() {
                return undefined;
              },
            };
          },
        };
      },
    } as never,
    {} as never,
    {
      findOne: async () => ({ enabled: true }),
    } as never,
    {
      get: async () => ({
        content: '# 我的偏好\n\n喜欢耐穿衣物。',
        revision: 4,
        updatedAt: null,
      }),
      async applyExtractedOperations(input: Record<string, unknown>) {
        appliedInput = input;
      },
    } as never,
  );

  await service.process({
    id: 'task-2',
    userId: 'user-1',
    conversationId: 'conversation-1',
    userMessageId: 'user-message-1',
    assistantMessageId: 'assistant-message-1',
    documentGeneration: 7,
    status: UserMemoryTaskStatus.PROCESSING,
  } as never);

  assert.equal(
    (JSON.parse(generatedInput) as { currentDocument: string }).currentDocument,
    '# 我的偏好\n\n喜欢耐穿衣物。',
  );
  assert.deepEqual(appliedInput, {
    userId: 'user-1',
    taskId: 'task-2',
    documentGeneration: 7,
    operations: [
      {
        operation: 'append',
        section: 'clothing',
        markdown: '偏好耐穿的基础款',
        explicit: true,
      },
    ],
  });
});

test('任务登记先取得文档锁，再捕获当前清空代次', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const entityManager = {
    getTransactionContext: () => ({ transaction: true }),
    getConnection: () => ({
      async execute(sql: string, params: unknown[]) {
        queries.push({ sql, params });
        if (sql.includes('select document_generation')) {
          return [{ document_generation: 3 }];
        }
        return [];
      },
    }),
  };

  await new UserMemoryTaskService({} as never).enqueueInTransaction(
    entityManager as never,
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant-message-1',
    },
  );

  assert.match(queries[0]!.sql, /pg_advisory_xact_lock/);
  assert.deepEqual(queries[0]!.params, ['user-memory-document:user-1']);
  assert.match(queries[1]!.sql, /select document_generation/);
  assert.match(queries[2]!.sql, /insert into user_memory_tasks/);
  assert.equal(queries[2]!.params[6], 3);
});
