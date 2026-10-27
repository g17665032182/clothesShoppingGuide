# 用户聊天记录模块技术文档

## 状态与上下文

- 状态：已确认，实施文档待确认
- 关联设计文档：[用户聊天记录模块设计文档](./chat-records-design.md)
- 关联 CRUD 契约：[用户聊天记录 CRUD 契约](../contracts/chat-records-crud-contract.md)
- 所属应用：`apps/api`
- 当前技术栈：NestJS 12、MikroORM 7.2、PostgreSQL、TypeScript 7、LangChain
- 最后更新：2026-10-27

## 实现目标

新增独立的 `ChatRecordsModule`，负责聊天记录持久化、会话归属、上下文压缩和分页查询。`LlmModule` 继续只负责模型调用，不直接访问数据库。

## 模块结构

```text
apps/api/src/chat-records/
  chat-records.module.ts
  chat-records.service.ts
  chat-context.service.ts
  chat-summary.service.ts
  chat-conversation.entity.ts
  chat-message.entity.ts
  dto/
    pagination.dto.ts
    admin-chat-query.dto.ts
  chat-records.controller.ts
  admin-chat-records.controller.ts
  llm-chat.controller.ts
  *.spec.ts
```

职责边界：

- `ChatRecordsService`：协调会话归属、模型调用、持久化和响应映射。
- `ChatContextService`：读取历史消息、计算 Token、选择最近消息和摘要上下文。
- `ChatSummaryService`：调用现有 `LlmService` 生成结构化历史摘要，不写入聊天消息表。
- `ChatConversation`、`ChatMessage`：只表达数据库结构和约束。
- Controller：只负责 HTTP 参数绑定、认证用户提取和调用 Service。

## 依赖和复用

- 复用现有 `LlmService`，不直接依赖 `ChatOpenAI` 或 LangGraph。
- 复用全局 JWT Guard、`@CurrentUser()`、`RolesGuard` 和 `@Roles(UserRole.ADMIN)`。
- 复用全局 `ValidationPipe`、`class-validator` 和 `class-transformer`。
- 复用 MikroORM `EntityRepository` 和 `findAndCount`。
- 使用 `js-tiktoken` 进行服务端 Token 估算；该包已由现有 LangChain 依赖带入，实施时提升为 `apps/api` 的直接依赖，避免依赖传递安装。

## LangGraph 集成边界

现有 `LlmModule` 继续拥有 LangGraph 和模型实例，Graph 保持最小模型调用流程：

```text
START -> chatModel -> END
```

`ChatRecordsModule` 不直接创建 `ChatOpenAI`，也不复制一套模型 Graph：

- 最终聊天回复通过 `LlmService.chat()` 调用现有 LangGraph。
- 历史摘要通过同一个 `LlmService.chat()` 调用现有 LangGraph，但摘要请求不会写入 `chat_messages`。
- 触发压缩时，先执行一次摘要 Graph，再执行一次最终回复 Graph。
- `ChatContextService` 负责准备输入，`LlmService` 负责 Graph 和供应商调用，`ChatRecordsService` 负责持久化。
- 数据库写入、用户归属校验和事务提交不放进 LangGraph 节点，避免模型编排承担业务副作用。

这样既复用现有 LangGraph 能力，也保持 `LlmModule` 不依赖聊天记录 Entity。

## 数据库设计

### `chat_conversations`

- `id uuid primary key`
- `user_id uuid not null`，外键指向 `users.id`
- `title varchar(200) not null`
- `context_summary text null`
- `summary_through_message_id uuid null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `user_id` 建立索引

### `chat_messages`

- `id uuid primary key`
- `conversation_id uuid not null`，外键指向 `chat_conversations.id`
- `role text not null`，检查值为 `user` 或 `assistant`
- `content text not null`
- `model varchar(100) null`
- `input_tokens integer null`
- `output_tokens integer null`
- `total_tokens integer null`
- `created_at timestamptz not null`
- `conversation_id` 建立索引

删除会话时使用数据库级 `ON DELETE CASCADE` 清理消息。摘要覆盖消息 ID 不建立外键，避免摘要状态阻止消息清理。

## 聊天调用流程

### 新会话

1. 验证请求至少包含一条 `user` 消息。
2. 使用请求消息构建初始模型上下文。
3. 调用 `LlmService`。
4. 模型成功后创建会话，生成标题并保存当前 user/assistant 消息。
5. 返回 `conversationId`、`title`、`content`、`model` 和 `usage`。

### 已有会话

1. 按当前用户和 `conversationId` 查询会话。
2. 从数据库读取完整历史；请求中的最后一条 `user` 消息作为当前轮输入。
3. `ChatContextService` 将历史摘要、可保留的旧消息和当前输入组合成模型上下文。
4. 调用 `LlmService`。
5. 成功后在一个持久化单元中保存当前 user/assistant 消息和新的摘要状态。

客户端传入的重复历史消息不重复写入数据库；数据库记录是已有会话的历史来源。

## Token 预算和上下文压缩

### 配置

新增服务端配置：

```env
LLM_CONTEXT_WINDOW_TOKENS=
LLM_TOKEN_ENCODING=cl100k_base
```

`LLM_CONTEXT_WINDOW_TOKENS` 必须是正整数；缺失或非法时返回配置不可用错误，不猜测供应商上下文上限。`LLM_TOKEN_ENCODING` 默认使用 `cl100k_base`，实施时根据供应商文档确认是否需要替换。

### 预算计算

```text
inputBudget = contextWindowTokens * 0.8
compressionTrigger = inputBudget * 0.75
hardLimit = inputBudget * 0.9
recentBudget = inputBudget * 0.30
summaryMaxTokens = 1024
```

Tokenizer 只用于请求前估算，不把估算值写入消息记录。超过硬上限时必须先压缩，不能直接调用模型。

### 压缩步骤

1. 保留系统消息（如果请求中存在），但不持久化。
2. 保留当前用户消息。
3. 从最新消息向前累积，直到达到 `recentBudget`。
4. 将更早且未被 `summaryThroughMessageId` 覆盖的消息，与已有 `contextSummary` 合并生成结构化摘要。
5. 摘要最多 1024 Token，字段固定为目标、事实、约束、决定、未解决问题。
6. 将摘要作为明确的历史上下文段落传给模型，不将摘要当作 system 指令。
7. 摘要成功后，最终模型请求使用“历史摘要 + 最近消息 + 当前消息”。

摘要失败时只记录非敏感失败指标，放弃本次摘要并使用最近消息上下文；如果仍超过硬上限，则从最旧的非当前消息开始丢弃，直到低于硬上限。

## API、DTO 和响应

- `ChatDto` 增加可选 `conversationId`，使用 UUID 校验。
- 分页 DTO 使用 `page` 和 `pageSize`，默认 1/20，最大 100。
- 路径 ID 使用 `ParseUUIDPipe`。
- 用户接口：`/api/chat/conversations`。
- 管理员接口：`/api/admin/chat/conversations`，类级别使用 `RolesGuard`。
- 自动保存入口继续使用 `/api/llm/chat`，响应增加 `conversationId` 和 `title`，保留旧字段以兼容现有客户端。

上下文摘要字段和 Token 预算不会出现在用户或管理员响应中。

## 事务与错误

- 模型调用前不写入本轮消息，模型失败不会产生半轮记录。
- 模型成功后的会话、消息和摘要状态在同一个 EntityManager flush 中提交。
- 资源不存在或不属于当前用户统一返回 `404`。
- `LLM_CONTEXT_WINDOW_TOKENS` 缺失或非法返回 `503`。
- 摘要调用失败不直接返回错误，按降级策略继续本轮调用。
- 不记录完整 Prompt、消息内容、摘要文本、API Key 或供应商原始错误。

## 测试方案

- `generateConversationTitle`：空白、Unicode 截断和长度边界。
- DTO：会话 ID、分页范围和未知字段。
- `ChatContextService`：75% 触发、90% 硬上限、最近消息保留、增量摘要和降级。
- `ChatRecordsService`：新/旧会话、归属校验、模型失败不落库、成功事务映射。
- Controller：当前用户调用、管理员角色保护和分页参数。
- Entity/Migration：字段类型、索引、外键和级联删除通过迁移检查确认。
- 自动化测试使用 Fake `LlmService` 和 Fake Repository，不依赖网络或真实 API Key。

## 验证命令

技术文档确认后，实施阶段执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api test
pnpm typecheck
pnpm build
pnpm check
pnpm --filter @clothes-shopping-guide/api migration:up
```
