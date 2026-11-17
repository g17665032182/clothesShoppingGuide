# 用户聊天记录模块实施文档

## 状态与上下文

- 状态：已确认，已实现
- 关联设计文档：[用户聊天记录模块设计文档](./chat-records-design.md)
- 关联技术文档：[用户聊天记录模块技术文档](./chat-records-technical.md)
- 关联 CRUD 契约：[用户聊天记录 CRUD 契约](../../contracts/chat-records-crud-contract.md)
- 所属应用：`apps/api`
- 最后更新：2026-10-27

## 实施目标

在不破坏现有 JWT、用户管理和 LLM 调用的前提下，新增聊天记录模块，完成自动保存、上下文压缩、分页查询、管理员查询和自动标题。

## 文件清单与所有权

### 新增聊天记录模块

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
  chat-records.service.spec.ts
  chat-context.service.spec.ts
```

### 现有文件调整

- `apps/api/src/llm/dto/chat.dto.ts`：增加可选 `conversationId`。
- `apps/api/src/llm/llm.module.ts`：继续只导出 `LlmService`，避免重复注册 `/llm/chat`。
- `apps/api/src/app.module.ts`：注册 `ChatRecordsModule`。
- `apps/api/src/database/migrations/`：新增会话、消息和摘要字段迁移。
- 根目录 `.env.example`：增加上下文窗口和 Token 编码配置。
- `apps/api/package.json`、`pnpm-lock.yaml`：将 `js-tiktoken` 提升为直接依赖。
- `docs/product/prd.md`、LLM 设计/技术文档：更新“无状态、不持久化”的过时描述。

公共配置、迁移和 `AppModule` 由主代理维护；模块内部文件按聊天记录模块集中修改。

## 实施顺序

1. 核对当前 Git 状态、数据库连接和现有 LLM 测试基线。
2. 安装并锁定 `js-tiktoken` 直接依赖，确认与 Node 22/ESM 兼容。
3. 实现 `ChatConversation`、`ChatMessage` Entity 和数据库迁移。
4. 实现分页 DTO、上下文 Token 预算和摘要状态映射。
5. 实现 `ChatContextService` 和 `ChatSummaryService`。
6. 实现 `ChatRecordsService`，接入现有 `LlmService` 和 LangGraph。
7. 实现用户、管理员和持久化聊天 Controller。
8. 注册 `ChatRecordsModule`，调整原有 `/api/llm/chat` 控制器注册，避免路由重复。
9. 更新环境变量示例、产品文档和 LLM 文档。
10. 增加上下文压缩、标题和分页边界测试，并通过真实 HTTP Smoke Test 验证持久化链路。
11. 顺序执行格式、测试、类型检查、构建和迁移验证。

## 迁移要求

- 新增 `chat_conversations`、`chat_messages` 表。
- 增加用户外键、会话外键、角色检查、分页索引和 `ON DELETE CASCADE`。
- `context_summary` 和 `summary_through_message_id` 可空，兼容已有用户数据。
- 迁移执行前审查生成 SQL，不使用 `migration:fresh` 清理现有数据。

## 测试验收

### 自动化测试

- DTO 接受合法 `conversationId`，拒绝非法 UUID、非法页码和未知字段。
- 标题生成覆盖空白、Unicode 和截断边界。
- 上下文压缩覆盖 75% 触发、90% 硬上限、最近消息保留和增量摘要。
- 摘要失败会降级，不阻断最终聊天。
- 新会话和已有会话均保存当前 user/assistant 消息。
- 模型失败不产生半轮记录。
- 普通用户无法读取其他用户会话。
- 管理员列表和详情受角色保护并支持分页。

### 命令

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api build
pnpm check
pnpm --filter @clothes-shopping-guide/api migration:up
git diff --check
```

## 手工 Smoke Test

数据库迁移完成后：

1. [x] 注册或使用已有用户获取 JWT。
2. [x] 调用 `POST /api/llm/chat`，确认返回 `conversationId` 和 `title`。
3. [x] 使用该 ID 查询详情，确认消息数量为 2。
4. [x] 查询用户会话列表和详情，确认分页字段正确。
5. [x] 使用普通用户访问管理员接口，确认返回 `403`。
6. [x] 使用无归属会话 ID 查询，确认返回 `404`。
7. [ ] 构造超长历史，确认摘要字段更新且原始消息未删除（需要额外长会话数据）。

## 风险和停止条件

- 如果供应商 Tokenizer 与 `cl100k_base` 差异明显，必须先调整编码配置和预算测试，不得静默上线。
- 如果摘要调用失败率过高，保留最近消息的降级路径，不阻塞聊天；后续再单独优化摘要。
- 如果迁移发现生产数据兼容性问题，停止迁移执行并先补充兼容迁移。
- 不引入流式持久化、全文搜索、消息编辑和管理员删除。
