# 后端系统上下文技术文档

## 文档信息

- 关联设计文档：[后端系统上下文设计](./system-context-design.md)
- 关联契约：[聊天记录 CRUD 契约](../../contracts/chat-records-crud-contract.md)
- 状态：已确认并接入
- 所属应用：`apps/api`
- 技术栈：NestJS、LangChain.js、LangGraph.js、TypeScript、Zod
- 最后更新：2026-11-02

## 实现目标

在服务端建立单一、固定的助手系统上下文，并应用于面向用户的聊天模型调用。系统消息只参与模型请求，不进入聊天消息、trace 事件、摘要输入或数据库。

```text
HTTP DTO (user/assistant only)
  -> ChatRecordsService or LlmController
  -> server-owned SystemMessage
  -> ChatContextService token budget planning (persisted chat)
  -> LlmService prepared-context entry
  -> LangGraph / Chat Model
```

无历史的直接聊天由 LLM 服务注入系统消息。持久化聊天在上下文规划时纳入服务端系统消息以准确计算 Token 预算，再将已组装消息交给 LLM 服务，避免重复注入。摘要等内部任务通过独立入口传入自己的消息，不自动套用服装导购上下文。

## 目录和职责

沿用现有 `apps/api/src/llm` 模块，不新增业务模块或数据库资源：

```text
apps/api/src/llm/
  context/
    system-context.md
    shopping-flow.md
    after-sales-flow.md
    system-context.ts
  dto/
    chat.dto.ts
  service/
    llm.service.ts
  spec/
    system-context.spec.ts
    chat.dto.spec.ts
    llm.service.spec.ts
```

- `context/system-context.md`：维护角色、行为边界、输出要求和流程路由，由 Nest 构建时复制到输出目录。
- `context/shopping-flow.md`、`context/after-sales-flow.md`：分别维护选购与退/换货对话流程，由 Nest 构建时复制到输出目录。
- `context/system-context.ts`：按固定顺序读取并组合三份 Markdown，导出完整上下文；不读请求字段或数据库。
- `dto/chat.dto.ts`：限制 HTTP 输入消息角色为 `user`、`assistant`，拒绝额外字段。
- `ChatContextService`：把服务端 system 消息计入持久化聊天的 Token 预算；系统消息不能进入历史摘要来源。
- `LlmService`：区分直接用户调用、已完成上下文规划的用户调用与内部任务调用，避免遗漏或重复注入。
- `ChatRecordsService`：继续构建并持久化用户消息和助手回复，不接触或保存系统上下文。

目录名和实现形式可根据现有模块风格调整，但系统上下文的内容所有权必须留在 `LlmModule`。

## 调用边界与消息组装

### 面向用户的非流式调用

- `POST /api/llm/chat` 和 `ChatRecordsService.chat()` 使用面向用户的 LLM 调用入口。
- 无持久化历史的 `/api/llm/chat` 由 `LlmService` 在传入 Graph 前，将固定 `SystemMessage` 放在本次模型输入最前面。
- `ChatRecordsService` 在 `ChatContextService.prepare()` 阶段将固定系统消息作为可信服务端输入，使其参与 token 预算和裁剪计算；裁剪计划输出的消息直接传给 prepared-context LLM 入口，不再二次注入。
- 请求消息只接收 `user` 和 `assistant`。系统消息不来自 DTO。

### 面向用户的流式调用

- `ChatRecordsService` 的流式聊天使用面向用户的流式入口。
- 服务端系统消息在上下文规划阶段计入 Token 预算，并只加入 Graph 的运行时状态，不生成 SSE `delta`，也不改变 `start`、`done` 响应契约。
- 已完成上下文规划的流式入口不得再次注入系统消息。

### 内部调用

- `ChatSummaryService` 使用明确的内部调用入口，保留其摘要专属 system 指令，不叠加服装导购系统上下文。
- 内部入口仅供后端模块代码使用，不映射为新的 HTTP 参数或请求字段。
- 不允许将请求 DTO 中的消息数组直接当作可信 system 配置。

## 持久化隔离

- `chat_messages` 只保存当前轮用户消息及最终助手回复。
- LangGraph 的 `persistInput` 只记录 human 输入；系统消息不得被改造成 human 消息。
- 模型 trace 只记录模型响应、工具事件等现有事件，不记录系统指令内容。
- 上下文裁剪与摘要来源继续使用历史消息映射；系统指令不并入历史消息、摘要来源或 `contextSummary`。
- 不新增 Entity、数据库字段、索引、Migration 或 Seeder。

现有 `ChatContextService.prepare()` 继续负责历史裁剪。它接收的 `systemMessages` 参数只由可信服务端提供，客户端请求内容不得映射到该参数。系统消息参与总上下文 token 计数，但不得出现在 `summarySource`、`messageSummarySource` 和持久化事件中。

## 请求 Schema、校验和错误映射

### Body Schema

沿用 `apps/api/src/llm/dto/chat.dto.ts` 的 `chatSchema`，不新增 Pipe 或校验库：

```ts
const chatMessageSchema = z.strictObject({
  role: z.enum([ChatMessageRole.USER, ChatMessageRole.ASSISTANT]),
  content: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
});

export const chatSchema = z.strictObject({
  conversationId: z.uuid().optional(),
  messages: z.array(chatMessageSchema).min(1).max(MAX_CHAT_MESSAGES),
  // 保留现有消息总长度限制
});
```

- 输入/解析类型：`ChatInput = z.infer<typeof chatSchema>`；角色只包含 `user | assistant`。
- `system` 或其他角色返回 `400`，不忽略、不转换为 user。
- `systemPrompt`、`systemContext`、`instructions` 等额外顶层字段由 `z.strictObject` 拒绝并返回 `400`。
- 消息对象中的任何未知字段同样返回 `400`。
- Controller 继续使用 `@Body({ schema: chatSchema })` 和现有 `StandardSchemaValidationPipe` 绑定。
- Swagger DTO 的角色枚举同步调整为只描述 `user` 与 `assistant`；运行时校验仍以 Zod schema 为准。
- 同一 DTO/schema 被 `/api/llm/chat`、`/api/chat/chat` 和 `/api/chat/chat/stream` 共用，避免入口之间规则漂移。

## 服务接口建议

保留现有模型输入能力，但将可信上下文入口在服务层显式区分。建议采用直接用户调用、已规划上下文调用和内部任务调用，具体命名在实现前依据现有调用点确认：

```ts
chat(input: UserChatInput, traceContext?: LlmTraceContext): Promise<ChatOutput>;
chatPrepared(
  input: ChatInput,
  traceContext?: LlmTraceContext,
): Promise<ChatOutput>;
streamPrepared(
  input: ChatInput,
  signal?: AbortSignal,
  traceContext?: LlmTraceContext,
): AsyncGenerator<string, LlmStreamResult>;
chatInternal(input: ChatInput): Promise<ChatOutput>;
```

- `chat` 为无持久化历史的客户端聊天创建并前置固定系统消息。
- `ChatRecordsService` 只将 `ChatContextService.prepare()` 生成的完整消息计划传给 `chatPrepared` / `streamPrepared`；这些入口不再注入。
- `chatInternal` 接收后端构造的 LangChain 消息，供摘要等任务使用，不自动注入导购上下文。
- HTTP DTO 类型不与内部 `ChatInput` 混用；DTO 转换只产生 user/assistant 消息。
- 不增加客户端可控制的注入开关，也不靠 HTTP 布尔参数切换调用模式。

## 安全和可观测性

- 系统上下文是源码中的服务端常量，不放入 `.env`，因为当前没有运行时编辑需求。
- 请求日志、trace、异常和响应都不得输出系统上下文全文。
- 客户端输入未知字段严格拒绝，防止以别名绕过角色校验。
- 系统指令不作为授权边界；真实商品、订单或售后能力未来接入时必须由服务端业务权限和工具实现保护。
- 供应商提示词遵循不保证绝对服从的模型特性；本功能只定义服务端指令和 API 输入边界。

## 测试方案

使用现有 Node 测试运行器和 Fake Chat Model，不依赖真实模型、凭据或外部网络。

- Schema：合法 user/assistant 输入通过。
- Schema：system、未知 role、消息级未知字段、`systemPrompt` 等额外字段均返回 `400`。
- Service：面向用户的调用将固定 SystemMessage 放在消息首位，且请求不能覆盖其文本。
- 上下文规划：系统上下文 Token 参与预算；超限时只裁剪历史消息，不裁剪系统消息和当前用户消息。
- Service：内部摘要调用收到专属消息，不会自动添加导购上下文。
- 持久化/上下文：trace 输入事件、历史摘要源和用户可见聊天消息中均不包含系统上下文。
- 流式：系统消息仅在模型输入中出现，不进入 SSE delta；现有事件顺序与响应结构不变。
- Controller：三个 HTTP 聊天入口均绑定同一严格 schema。

## 验证命令

实现阶段至少执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
```

## 确认后续

本次 Token 预算边界变更待用户重新确认。确认后才能编写实施文档；实施文档确认前不修改业务代码。
