# 用户聊天记录 CRUD 契约

## 状态与上下文

- 状态：已确认
- 资源名称：聊天会话与聊天消息
- 业务目的：持久化用户与大模型的聊天记录，并支持管理员分页查询。
- 需求来源：用户明确要求自动保存、管理员查询、分页和标题自动生成。
- 确认依据：用户回复；现有 `LlmModule`、JWT Guard、RolesGuard 和 MikroORM 约定。
- 涉及模块：`apps/api/src/chat-records`、`apps/api/src/llm`、数据库迁移。
- 当前框架：NestJS 12、MikroORM 7.2、PostgreSQL、TypeScript 7。
- 最后更新：2026-10-27

## 范围

- 包含：自动保存当前聊天轮次、用户会话列表/详情/删除、管理员列表/详情、分页和自动标题。
- 包含：调用模型前的聊天上下文压缩，完整原始消息仍然保留。
- 不包含：消息编辑、消息单独删除、全文搜索、管理员删除和系统消息持久化。
- 路由前缀：全局 `/api`。

## 字段契约

| 字段                  | API/类型          | 数据库类型     | 创建必填  | 更新语义     | 可空 | 约束与安全                                                         |
| --------------------- | ----------------- | -------------- | --------- | ------------ | ---- | ------------------------------------------------------------------ |
| 会话 `id`             | `string`          | `uuid`         | 否        | 不可变       | 否   | 主键，服务端生成                                                   |
| 会话 `userId`         | `string`          | `uuid`         | 是        | 不可变       | 否   | 仅服务端写入，外键用户                                             |
| 会话 `title`          | `string`          | `varchar(200)` | 是        | 首次创建生成 | 否   | 首条用户消息截断生成                                               |
| 会话上下文摘要        | 内部字符串        | `text`         | 否        | 增量更新     | 是   | 不对外返回                                                         |
| 摘要覆盖消息          | 内部 UUID         | `uuid`         | 否        | 随摘要更新   | 是   | 不对外返回                                                         |
| 会话时间              | `string`          | `timestamptz`  | 否        | 系统维护     | 否   | ISO 8601                                                           |
| 消息 `id`             | `string`          | `uuid`         | 否        | 不可变       | 否   | 主键，服务端生成                                                   |
| 消息 `conversationId` | `string`          | `uuid`         | 是        | 不可变       | 否   | 外键，会话删除级联                                                 |
| 消息 `role`           | `user\|assistant` | `text`         | 是        | 不可变       | 否   | 不保存 system                                                      |
| 消息 `content`        | `string`          | `text`         | 是        | 不可变       | 否   | 保存应用层标准化文本，不保存 LangChain 对象，沿用 LLM DTO 长度限制 |
| 消息 `model`          | `string`          | `varchar(100)` | assistant | 不可变       | 是   | 用户消息为空                                                       |
| Token 用量            | `number`          | `int4`         | 否        | 不可变       | 是   | 上游未返回时为空                                                   |
| 消息时间              | `string`          | `timestamptz`  | 否        | 系统维护     | 否   | ISO 8601                                                           |

## API 契约

| 操作           | 方法与路由                              | 认证/授权 | 响应                                  |
| -------------- | --------------------------------------- | --------- | ------------------------------------- |
| 聊天并保存     | `POST /api/llm/chat`                    | 登录用户  | `ChatOutput + conversationId + title` |
| 我的会话列表   | `GET /api/chat/conversations`           | 登录用户  | 分页会话                              |
| 我的会话详情   | `GET /api/chat/conversations/:id`       | 登录用户  | 会话 + 分页消息                       |
| 删除我的会话   | `DELETE /api/chat/conversations/:id`    | 登录用户  | `204`                                 |
| 管理员会话列表 | `GET /api/admin/chat/conversations`     | 管理员    | 分页会话，可按 `userId` 过滤          |
| 管理员会话详情 | `GET /api/admin/chat/conversations/:id` | 管理员    | 会话 + 分页消息                       |

## 查询、权限与数据行为

- 分页：`page` 默认 1，`pageSize` 默认 20，最大 100。
- 会话排序：`updatedAt desc`；消息排序：`createdAt asc`。
- 资源归属：普通用户只能读取/删除 `userId` 等于当前用户的会话。
- 删除方式：物理删除会话，消息通过外键级联删除。
- 模型调用失败：不保存本轮消息。
- 上下文压缩只影响发送给模型的请求，不修改或删除数据库中的原始消息。
- `LLM_CONTEXT_WINDOW_TOKENS` 由服务端配置；输入预算预留约 20% 输出空间。
- 可用输入预算达到 75% 时触发压缩，达到 90% 时必须压缩。
- 保留最近 25%～35% 输入预算，较早消息压缩为 512～1024 Token 结构化摘要。
- 使用摘要覆盖消息 ID 做增量压缩；摘要失败时降级为最近消息上下文。
- 标题生成：首条用户消息规范化后截取 30 个 Unicode 字符。
- 消息内容保存 DTO/LlmService 转换后的字符串，不保存 LangChain `BaseMessage` 或供应商原始结构。
- 不存在或越权资源：统一返回 `404`。

## 实现映射

| 能力       | 复用实现                         | 新增内容                      |
| ---------- | -------------------------------- | ----------------------------- |
| Repository | MikroORM Nest 集成               | 两个 EntityRepository         |
| DTO        | 全局 ValidationPipe              | 分页、管理员过滤、可选会话 ID |
| 认证       | 全局 JWT Guard、`@CurrentUser()` | 无新 Guard                    |
| 管理员授权 | `RolesGuard`、`@Roles()`         | 无新授权体系                  |
| Migration  | MikroORM Migrator                | 两张表、索引、外键和角色检查  |

## 验收清单

- [x] 聊天成功自动保存 user/assistant 消息。
- [x] 用户归属和管理员权限正确。
- [x] 会话和消息查询支持分页。
- [x] 标题自动生成。
- [x] 测试、构建、格式和迁移检查通过。
