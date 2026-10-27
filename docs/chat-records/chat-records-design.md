# 用户聊天记录模块设计文档

## 状态与上下文

- 状态：已确认
- 业务目的：保存登录用户与大模型的聊天会话，支持用户回看和管理员分页查询。
- 所属应用：`apps/api`
- 关联模块：`LlmModule`、`UsersModule`、`authorization`
- 最后更新：2026-10-27

## 范围

### 包含

- `POST /api/llm/chat` 调用成功后自动保存用户消息和模型回复。
- 调用模型前根据上下文阈值压缩较早的聊天内容。
- 用户创建、分页查询、详情查询和删除自己的聊天会话。
- 管理员分页查询全部聊天会话，并查看指定会话消息。
- 首条用户消息自动生成会话标题。
- 会话和消息按用户归属校验，禁止越权读取。

### 不包含

- 不保存系统提示词和客户端重复提交的历史消息。
- 不实现消息编辑、单条消息删除、导出和全文搜索。
- 不新增管理员删除接口。
- 不改变现有 LLM 供应商配置和模型调用策略。

## 用户角色与权限

| 角色       | 权限                           |
| ---------- | ------------------------------ |
| 普通用户   | 调用聊天、查看和删除自己的会话 |
| 管理员     | 分页查看所有用户会话和消息     |
| 未登录用户 | 无权调用聊天或查看记录         |

## 数据模型

### ChatConversation

- `id`：UUID 主键。
- `userId`：所属用户 UUID。
- `title`：自动生成的会话标题，最多 200 个字符。
- `contextSummary`：内部历史上下文摘要，不直接返回客户端。
- `summaryThroughMessageId`：摘要已覆盖的最后一条消息 ID，不直接返回客户端。
- `createdAt`、`updatedAt`：时间戳。

### ChatMessage

- `id`：UUID 主键。
- `conversationId`：所属会话 UUID。
- `role`：`user` 或 `assistant`。
- `content`：应用层标准化后的消息文本，不保存 LangChain `BaseMessage` 或供应商原始结构。
- `model`：模型名称，用户消息为空。
- `inputTokens`、`outputTokens`、`totalTokens`：模型返回的用量，缺失时为空。
- `createdAt`：创建时间。

消息内容规则：

- 用户消息保存 DTO 校验并去除首尾空白后的字符串。
- assistant 消息保存 `LlmService` 标准化后的文本字符串。
- LangChain 消息对象只在内存中使用，不写入数据库。
- 当前不保存 `system` 消息。

## API 契约

### 自动保存聊天

`POST /api/llm/chat`

- 认证：Bearer JWT。
- 请求：沿用现有 `messages`，可选 `conversationId`。
- 行为：调用成功后保存当前轮用户消息和 assistant 回复；没有 `conversationId` 时创建新会话。
- 响应：保留原有 `content`、`model`、`usage`，增加 `conversationId` 和 `title`。

### 用户记录

- `GET /api/chat/conversations?page=1&pageSize=20`
- `GET /api/chat/conversations/:id?page=1&pageSize=20`
- `DELETE /api/chat/conversations/:id`

### 管理员记录

- `GET /api/admin/chat/conversations?page=1&pageSize=20&userId=<uuid>`
- `GET /api/admin/chat/conversations/:id?page=1&pageSize=20`

分页响应统一为：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "totalPages": 0
}
```

## 关键行为

- 标题取首条用户消息，压缩连续空白并截取前 30 个 Unicode 字符；超长标题追加 `...`。
- 模型调用失败时不写入聊天记录，避免保存没有 assistant 回复的半轮数据。
- 删除会话时级联删除消息。
- 用户消息只保存当前请求中最后一条 `user` 消息，避免客户端重复提交完整历史造成重复记录。
- 数据库始终保留完整原始消息；上下文压缩只作用于发送给模型的输入。
- `LLM_CONTEXT_WINDOW_TOKENS` 由服务端配置，不能硬编码模型上下文长度。
- 输入预算预留约 20% 给模型输出，达到可用输入预算 75% 时触发压缩，达到 90% 时视为硬上限。
- 上下文服务保留最近约 25%～35% 的输入预算，并将较早消息压缩为 512～1024 Token 的结构化摘要。
- 摘要包含用户目标、已确认事实、约束条件、已做决定和未解决问题。
- `summaryThroughMessageId` 用于增量摘要，避免每次重新压缩全部历史。
- `system` 消息、当前用户消息和最近消息不参与历史摘要。
- 摘要失败时降级为只保留最近消息，不阻断本次聊天。
- 摘要不对外暴露，技术文档阶段只细化字段映射、Tokenizer 选择和执行流程。

## 验收清单

- [ ] 聊天成功后会话和两条消息持久化。
- [ ] 会话 ID 可继续追加聊天。
- [ ] 用户只能访问自己的会话。
- [ ] 管理员可以按页查询会话和详情。
- [ ] 标题自动生成且不额外调用模型。
- [ ] 迁移、测试、类型检查、构建和格式检查通过。
