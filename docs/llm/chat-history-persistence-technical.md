# LangGraph 节点级聊天历史持久化技术文档

## 文档信息

- 关联设计文档：[LangGraph 节点级聊天历史持久化设计](./chat-history-persistence-design.md)
- 关联契约：[用户聊天记录 CRUD 契约](../contracts/chat-records-crud-contract.md)
- 状态：已确认
- 所属应用：`apps/api`
- 技术栈：NestJS、LangChain.js、LangGraph.js、MikroORM、PostgreSQL、TypeScript
- 最后更新：2026-10-29

## 技术目标

将 LangGraph 每轮模型输出和工具执行结果通过专用节点写入聊天 trace 事件；继续用 `chat_messages` 提供现有前端会话详情 API；后续请求从 trace 事件恢复 LangChain 消息上下文。

```text
ChatRecordsModule
  -> 校验 conversation 所有权
  -> 准备历史上下文和 runId
  -> LlmService.chat/stream(input, traceContext)
      -> LangGraph
          -> persistInput
          -> chatModel
          -> persistModelEvent
          -> tools
          -> persistToolEvent
  -> 保持现有 ChatMessage 展示投影
```

本阶段不使用 LangGraph Checkpoint，也不让 `LlmModule` 直接依赖 MikroORM 或聊天业务 Entity。流式路径也必须经过同一 Graph，不能继续绕过 Graph 直接调用 `chatModel.stream()`。

## 本地依赖和依赖方案

项目已经安装并使用以下能力，无需重复增加：

- `@langchain/langgraph`：已有 `StateGraph`、`MessagesValue` 和 `ToolNode`。
- `@langchain/core`：已有 `BaseMessage`、`AIMessage`、`HumanMessage`、`ToolMessage` 等消息抽象。
- `@mikro-orm/nestjs`、`@mikro-orm/postgresql`、`@mikro-orm/migrations`：已有 Repository、Entity 和 Migration 管理。
- `zod`：已有 Graph 状态 Schema。

第一版不新增数据库驱动、Checkpoint 包或外部持久化服务。官方 LangGraph 文档支持通过 `StateGraph` 节点执行异步操作，也允许通过图运行配置提供每次调用的上下文；实现时应以仓库锁定的 LangGraph 版本 API 为准。

## 目录和模块边界

```text
apps/api/src/llm/
  llm.graph.ts
  llm.service.ts
  llm.state.ts
  llm.tokens.ts
  trace/
    llm-trace-writer.ts
    llm-trace.types.ts

apps/api/src/chat-records/
  chat-records.module.ts
  chat-records.service.ts
  chat-trace-event.entity.ts
  chat-trace-writer.service.ts
  chat-history.mapper.ts
  chat-context.service.ts
  chat-summary.service.ts

apps/api/src/database/migrations/
  Migration<timestamp>.ts
```

职责和依赖方向：

```text
LlmModule
  -> 声明 LlmTraceWriter 端口
  -> 在 Graph 节点中调用端口

ChatRecordsModule
  -> 实现 LlmTraceWriter
  -> 通过每次 LlmService.chat() 的运行上下文传入
  -> 使用 MikroORM Repository 写入 chat_trace_events
```

`ChatRecordsModule` 可以依赖 `LlmModule` 导出的端口类型；`LlmModule` 不得反向导入聊天模块。运行时 writer 通过 Graph invoke 的 context/config 传入，不注册为 LLM Graph 的全局数据库依赖，也不放进可序列化 Graph state。

## 事件写入端口

LLM 模块定义与 MikroORM 无关的窄接口。概念类型如下：

```ts
type LlmTraceEvent =
  | {
      type: 'input';
      messageId: string;
      content: string;
    }
  | {
      type: 'model_response';
      messageId: string;
      content: string;
      model: string;
      usage: LlmUsage | null;
    }
  | {
      type: 'tool_call';
      messageId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: 'tool_result';
      messageId: string;
      toolCallId: string;
      toolName: string;
      content: string;
      status: 'success' | 'failed';
    };

interface LlmTraceWriter {
  writeEvents(events: LlmTraceEvent[]): Promise<void>;
}
```

一次 Graph 调用的运行上下文携带：

```ts
type LlmTraceContext = {
  conversationId: string;
  runId: string;
  writer: LlmTraceWriter;
};
```

事件的 `conversationId` 和 `runId` 由经过会话权限校验的服务端创建；不能从工具参数、Prompt 或未校验的客户端字段读取。

## Graph state 和节点接线

`LlmState` 继续使用 `MessagesValue` 管理 `BaseMessage[]`，并增加本次运行所需的非敏感标识字段。数据库 writer 不放入 `LlmState`。

节点行为：

1. `persistInput` 读取本轮输入中的当前用户消息，写入 `input` 事件，然后不改变消息状态。
2. `chatModel` 调用已绑定工具的模型并追加 `AIMessage`。
3. `persistModelEvent` 读取当前新增的最后一条 AI 消息，保存模型响应；如果消息包含 tool calls，则为每个调用追加 `tool_call` 事件，事件按模型消息中的调用顺序写入。
4. 条件路由依据最后一条 AI 消息的 `tool_calls` 选择 `tools` 或 `END`。
5. `tools` 继续使用官方 `ToolNode` 执行调用。
6. `persistToolEvent` 读取当前新增的 `ToolMessage`，按 `toolCallId` 写入工具结果或失败事件。
7. 工具结果写入成功后回到 `chatModel`；最终无工具调用时结束。

编译后的 Graph 保持单例。每次 invoke 的 trace context 经 LangGraph runtime context/config 传给节点，避免按会话重复编译 Graph。

## 数据模型和 Migration

新增 `ChatTraceEvent` Entity 和 `chat_trace_events` 表，建议结构：

| 列                | 类型           | 约束/用途                                                    |
| ----------------- | -------------- | ------------------------------------------------------------ |
| `id`              | `uuid`         | 主键，服务端生成                                             |
| `conversation_id` | `uuid`         | 外键到会话，删除级联                                         |
| `run_id`          | `uuid`         | 本轮调用 ID                                                  |
| `sequence`        | `int4`         | 本轮事件序号                                                 |
| `event_type`      | `text`         | 仅允许 `input`、`model_response`、`tool_call`、`tool_result` |
| `message_id`      | `text`         | LangChain message ID，可空                                   |
| `tool_call_id`    | `text`         | 工具调用关联 ID，可空                                        |
| `tool_name`       | `varchar(200)` | 工具名称，可空                                               |
| `content`         | `text`         | 规范化文本或安全错误摘要，可空                               |
| `payload`         | `jsonb`        | 脱敏后的工具参数、结果或结构化消息数据，可空                 |
| `status`          | `text`         | `success`、`failed`、`partial`                               |
| `model`           | `varchar(100)` | 模型名称，可空                                               |
| `usage`           | `jsonb`        | Token 用量，可空                                             |
| `created_at`      | `timestamptz`  | 创建时间                                                     |

约束和索引：

- 外键 `conversation_id -> chat_conversations.id`，`ON DELETE CASCADE`。
- 唯一索引 `(conversation_id, run_id, sequence)`，保证本轮事件重试幂等。
- 查询索引 `(conversation_id, created_at, sequence)`。
- 工具事件另建 `(conversation_id, tool_call_id)` 索引，便于关联调用和结果。
- Migration 只新增事件表及索引，不修改 `chat_messages` API 字段。

### 历史兼容

- 新功能上线前已有的 `chat_messages` 没有工具事件。
- 首次为某会话生成 trace 前，将该会话现有消息按创建顺序转换成对应的 `input` 或 `model_response` 事件。
- 事件表已包含该会话的 trace 后，后续上下文以 trace 事件为准，避免重复读取 `chat_messages` 投影。
- legacy 导入需有幂等标记或唯一键，重复请求不得重复导入。
- 已有历史只包含普通 user/assistant 文本，不伪造工具调用记录。

## 写入和失败处理

- Graph 每个持久化节点通过 `LlmTraceWriter.writeEvents()` 写入；单次节点中的关联事件使用一个数据库事务。
- 事件按节点提交，不能将整个模型调用和工具执行包在长事务中。
- `(conversation_id, run_id, sequence)` 冲突时按幂等重放处理；内容不一致时返回持久化冲突，不覆盖已有事件。
- 事件写入失败时节点抛错，Graph 调用失败；不得返回成功回复却漏掉必需事件。
- 已提交的前序事件在后续模型或工具失败时保留；失败事件记录安全摘要，不记录原始异常栈和供应商响应。
- `ChatMessage` 的 user/assistant 展示投影继续只由 ChatRecords 应用流程保存；Graph trace 事件不直接写入展示消息表。

## 内部 payload 安全策略

参数和工具结果可能携带用户数据，不能默认永久保存未经处理的完整对象：

- 写入前递归移除或掩码键名匹配 `password`、`secret`、`token`、`apiKey`、`authorization`、`credential` 的字段。
- 非 JSON 值先规范化；循环引用、不可序列化对象不得直接落库。
- 单个 payload 序列化后上限为 `32768` 字节；超限时拒绝该事件写入并让当前 Graph 失败。
- 日志不得打印 payload、完整 Prompt、工具参数、工具结果或密钥。
- 数据库访问限定在 ChatRecords 模块内部；不新增读取 trace 的 HTTP API。

V1 使用常见凭证字段递归掩码。该方式不足以识别所有个人敏感信息；生产工具接入前应按工具的数据分类增加字段级 allowlist 或专属脱敏器。

## 历史消息类型转换与上下文压缩

新增 `chat-history.mapper.ts`，职责限定为：

- `input` 转 `HumanMessage`，`model_response` 转 `AIMessage`。
- 带工具调用的 `model_response` 转 `AIMessage` 并保留标准 `tool_calls` 字段。
- `tool_result` 转 `ToolMessage`，保留 `tool_call_id`。
- 忽略审计用途但不参与模型上下文的元数据。

`ChatContextService` 需从仅支持 `{ role, content }` 的字符串模型扩展为消息项模型，按消息内容和工具参数/结果估算 token。裁剪时必须保留完整工具调用闭环：不能留下没有对应结果的 `AIMessage.tool_calls`，也不能留下没有前置调用的 `ToolMessage`。摘要失败时回退到最近的完整消息组。

客户端提供的 assistant 历史仍不作为可信持久化来源；会话历史只由数据库事件重建，当前请求取最后一条 user 消息。新会话在 Graph 开始前创建，以支持 `persistInput` 在模型前写入 trace；客户端取消时删除新会话并级联清理 trace，模型或工具失败时保留会话和已提交 trace，但不保存展示消息。

## API 和流式接口

### 非流式聊天

- `POST /api/llm/chat` 保持原请求和响应 DTO。
- `conversationId` 先由 ChatRecords 校验归属，然后服务端创建 `runId` 并调用 LlmService。
- 响应仍只包含最终回复、模型、用量、会话 ID 和标题。
- 工具调用消息及参数不进入任何公开响应 DTO。

### 流式聊天

- `/api/llm/chat/stream` 消费 Graph 的流式输出，保持现有 `start`、`delta`、`done`、`error` SSE 事件格式。
- 模型节点使用 LangChain 消息块流；服务端将同一模型节点产生的 `AIMessageChunk` 聚合，直到该节点结束。
- 聚合结果没有 tool calls 时，文本按顺序转换为可展示 `delta`，模型事件由持久化节点记录。
- 聚合结果包含 tool calls 时，tool-call chunks、工具名称和参数不发送给前端；服务端先持久化 `model_response`/`tool_call`，再进入 `ToolNode`。
- `ToolNode` 完成后，`persistToolEvent` 持久化工具结果；Graph 回到模型节点并继续流式输出最终文本。
- 工具执行期间允许没有 `delta`。只有最终模型回复完成、展示投影事务成功后才发送 `done`。
- 工具执行期间不新增 SSE 心跳。
- 工具参数不完整、无法解析或工具执行失败时，记录安全失败事件并发送公开 `error`，不发送工具原始参数和错误详情。
- 客户端取消时停止后续模型和工具处理；已提交的内部事件保留，未完成的展示 assistant 消息不落库。

优先复用 LangGraph `stream`/`streamEvents` 和 LangChain `AIMessageChunk` 聚合能力；不要自行按字符串拼接工具参数。

## NestJS 注册

`ChatRecordsModule` 注册 `ChatTraceEvent` Entity 和具体 writer；`LlmModule` 只导出 `LlmService` 及公开 trace 类型。Graph 节点从本次运行上下文取得 writer，不通过 Nest 全局容器动态查找聊天 Service。

推荐调用边界：

```ts
llmService.chat(
  { messages: preparedMessages },
  {
    conversationId,
    runId,
    writer: chatTraceWriter,
  },
);
```

生产实现需保持 `LlmService` 的常规调用类型安全；不能让外部 Controller 直接传入任意 writer。

## 测试方案

### LLM/Graph 单元测试

- 输入节点写入 user 事件后保持消息状态不变。
- 普通模型回复产生一个 `model_response` 事件并正常结束。
- 模型返回一个或多个 tool calls 时，调用事件被记录、`ToolNode` 执行后结果按 `toolCallId` 记录，再回到模型节点。
- 模型连续调用工具时每轮事件顺序稳定且唯一。
- Writer 失败会使 Graph 失败，不返回成功答案。
- Graph state 不含 writer 实例或数据库对象。

### ChatRecords 单元测试

- 新会话、已有会话和越权会话均正确校验。
- 旧消息只导入一次；重复执行导入保持幂等。
- trace 重建出的消息保持 AI tool calls 与 ToolMessage 的关联。
- Context trim 保留完整调用闭环并满足预算。
- 用户和管理员详情仍只返回 user/assistant 投影。
- 删除会话后关联 trace 事件删除。
- 脱敏覆盖凭证字段；超限 payload 按失败策略处理。

### Migration/集成验证

- 验证外键级联、唯一键、查询索引和 migration down。
- 使用测试数据库验证一次完整模型-工具-模型循环写入和下一轮上下文恢复。
- 测试不依赖真实供应商密钥、真实工具服务或不可控网络。

## 已确认的实施决策

1. 单事件 payload 序列化上限为 `32768` 字节，超限拒绝写入并使 Graph 失败。
2. V1 递归掩码常见凭证字段；按工具增加更严格的 allowlist 或专属脱敏器作为后续要求。
3. 流式工具调用期间不新增 SSE 心跳。

本技术文档已纳入用户授权确定的 payload 限制、脱敏和心跳决策；实施前须确保设计、契约和本技术文档保持一致。
