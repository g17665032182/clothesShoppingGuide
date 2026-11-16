# LangGraph 节点级聊天历史持久化实施文档

## 文档信息

- 关联设计文档：[LangGraph 节点级聊天历史持久化设计](./chat-history-persistence-design.md)
- 关联技术文档：[LangGraph 节点级聊天历史持久化技术文档](./chat-history-persistence-technical.md)
- 关联契约：[用户聊天记录 CRUD 契约](../../contracts/chat-records-crud-contract.md)
- 状态：已确认
- 所属应用：`apps/api`
- 最后更新：2026-10-29

## 实施范围

### 本期包含

- 通过 `addNode` 为 LangGraph 增加用户输入、模型响应、工具调用和工具结果持久化。
- 新增内部 `chat_trace_events` Entity、Migration 和 MikroORM writer。
- 保持 `chat_messages` 作为公开聊天详情的 user/assistant 投影。
- 首次使用 trace 的会话导入既有历史消息，并保证重复导入幂等。
- 后续模型上下文从 trace 事件重建，完整保留工具调用与结果配对。
- 上下文压缩、会话归属、删除级联和公开 API 行为保持符合已确认契约。
- SSE 工具调用纳入本期：工具调用片段只在服务端聚合，执行和持久化完成后继续后续模型流；前端只接收可展示文本。

### 本期不包含

- LangGraph Checkpoint 和图执行恢复。
- 前端展示或查询内部工具事件。
- 新增业务工具或修改现有工具业务规则。
- 新增 trace 查询 API。
- 断线续传、流重放和新模型供应商。

## 已确认的实施决策

- 单个事件 payload 序列化后最大 `32768` 字节；超限拒绝写入并使 Graph 失败。
- V1 递归掩码常见凭证字段，后续按工具增加 allowlist 或专属脱敏器。
- 工具执行期间不新增 SSE 心跳。

## 文件所有权拆分

正式编码阶段按以下边界分工。每个实现代理只拥有其列出的文件；不得并行修改同一文件。主集成方独占所有共享接线文件。

### 子任务 A：LLM trace 端口与 Graph 节点

负责：

```text
apps/api/src/llm/llm.graph.ts
apps/api/src/llm/llm.service.ts
apps/api/src/llm/llm.state.ts
apps/api/src/llm/trace/llm-trace-writer.ts
apps/api/src/llm/trace/llm-trace.types.ts
apps/api/src/llm/llm.graph.spec.ts
apps/api/src/llm/llm.service.spec.ts
apps/api/src/llm/llm.stream.spec.ts
```

验收：

- Graph 用 `persistInput`、`persistModelEvent`、`persistToolEvent` 记录节点产物。
- writer 通过每次运行上下文传入，不放入 state，不让 LLM 模块依赖 MikroORM。
- 工具调用、工具结果与 `toolCallId` 保持关联。
- writer 写入失败会中止 Graph，不能返回未持久化的成功回复。
- 新增必要注释使用中文。
- 流式模型节点能聚合 `AIMessageChunk`，工具片段不会变成公开文本 `delta`。
- 工具完成后 Graph 能继续模型流，并按顺序持久化模型、工具调用和工具结果事件。

禁止修改：

- `apps/api/src/chat-records/**`
- `apps/api/src/database/migrations/**`
- `apps/api/src/llm/llm.module.ts`

### 子任务 B：聊天 trace 存储模型与写入服务

负责：

```text
apps/api/src/chat-records/chat-trace-event.entity.ts
apps/api/src/chat-records/chat-trace-writer.service.ts
apps/api/src/chat-records/chat-trace-writer.service.spec.ts
```

验收：

- 表结构、外键级联、幂等唯一键和查询索引符合技术文档。
- 事件批写使用短事务，不跨模型调用持有事务。
- payload 按最终确认的大小限制和脱敏规则处理。
- 失败消息仅保存安全摘要，不记录原始异常详情。
- 向主集成方提供 Entity、索引、外键和幂等约束需求，不修改 Migration 文件。

禁止修改：

- `apps/api/src/llm/**`
- `apps/api/src/chat-records/chat-records.service.ts`
- `apps/api/src/chat-records/chat-records.module.ts`

### 子任务 C：聊天历史重建与上下文

负责：

```text
apps/api/src/chat-records/chat-history.mapper.ts
apps/api/src/chat-records/chat-history.mapper.spec.ts
apps/api/src/chat-records/chat-context.service.ts
apps/api/src/chat-records/chat-context.service.spec.ts
apps/api/src/chat-records/chat-summary.service.ts
apps/api/src/chat-records/llm-chat.controller.spec.ts
```

验收：

- legacy 普通消息可转换为新 trace 事件且只导入一次。
- trace 能重建 `HumanMessage`、含 tool calls 的 `AIMessage` 和 `ToolMessage`。
- 摘要和 token 裁剪按完整工具调用闭环进行，不遗留孤立调用或结果。
- 摘要失败时回退到最近完整消息组。
- 输入仅包含经会话归属校验后读取的服务端历史。
- SSE 只收到公开文本 `delta`；工具调用参数和结果不出现在 SSE。

禁止修改：

- `apps/api/src/llm/**`
- `apps/api/src/chat-records/chat-records.service.ts`
- `apps/api/src/chat-records/chat-records.module.ts`

### 主集成方：应用接线、迁移与跨模块验证

主集成方独占：

```text
apps/api/src/chat-records/chat-records.service.ts
apps/api/src/chat-records/chat-records.service.spec.ts
apps/api/src/chat-records/chat-records.module.ts
apps/api/src/chat-records/chat-records.controller.ts
apps/api/src/chat-records/admin-chat-records.controller.ts
apps/api/src/llm/llm.module.ts
apps/api/src/database/migrations/**
```

主集成方负责：

- 注册 Entity、Repository 和具体 writer。
- 创建并维护 Migration，审阅 SQL 和回滚行为。
- 串接经授权的 conversation、`runId`、历史消息、上下文计划和 LLM 调用。
- 保留 user/assistant 展示投影且只写一次。
- 确保普通用户与管理员详情 API 不返回内部 trace。
- 确保删除会话级联清理 trace。
- 整合各子任务修改，解决类型、依赖注入和迁移冲突。
- 运行完整检查并执行数据库集成验证。

子代理不得修改上述共享接线文件。若实现期间需要变更文件所有权，先暂停并由主集成方重新分配。

## 实施阶段

### 阶段 1：存储基础

- 新增 trace Entity 和 Migration。
- 审核表字段、索引、外键、删除级联和唯一键。
- 新增 writer、凭证掩码和 payload 大小校验。
- 补充 writer 单元测试与 Migration 验证。

### 阶段 2：LangGraph 节点记录

- 定义 LLM trace 类型与 writer 端口。
- 扩展 `LlmState` 和每次 invoke 的运行上下文。
- 调整 Graph 节点顺序并接入持久化节点。
- 补充普通回答、单/多工具调用、工具失败和写入失败测试。

### 阶段 3：聊天服务集成

- 对当前用户和 conversation 做现有归属校验。
- 创建服务端 `runId`，读取并准备历史上下文。
- 首次调用时幂等导入 legacy 消息。
- 从 trace 重建历史并运行现有 token 预算和摘要流程。
- 保留现有 `chat_messages` 展示投影和响应 DTO。
- 删除会话时验证内部事件级联清理。
- 新会话在 Graph 开始前创建；仅客户端取消会清理该新会话，模型或工具失败保留 trace 但不生成展示消息。

### 阶段 4：跨层验证

- 用测试数据库验证完整 `chatModel -> tools -> chatModel` 事件顺序。
- 发起第二轮对话，验证模型输入能重建上一轮 ToolCall/ToolMessage。
- 验证普通用户和管理员接口均不包含 trace payload。
- 验证模型、工具或 writer 失败后的存储语义。
- 验证旧会话升级后历史消息未丢失且没有重复导入。
- 验证 SSE 在工具调用暂停后能继续发送最终文本，并在展示事务成功后发送 `done`。

## 验证清单

每个实现任务完成后先运行所属测试；集成完成后按仓库要求运行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
```

数据库迁移验证：

- 检查 Migration SQL、外键、索引、幂等约束和回滚 SQL。
- 只对明确可销毁的本地或 CI 数据库执行迁移验证。
- 禁止为了验证该功能执行非隔离环境的 `migration:fresh`。

手工 Smoke Test：

- 创建新会话并触发一次工具调用。
- 读取聊天详情，确认只出现 user/assistant 消息。
- 继续同一会话，确认上下文包含前轮工具结果。
- 删除会话，确认 trace 行级联删除。
- 不将 API Key、工具 payload 或完整 Prompt 输出到终端和日志。

本次已使用临时启用的 `local_echo_tool` 完成上述核心链路验证：
模型实际产生工具调用，`ToolNode` 执行结果后再次调用模型，最终答案包含工具返回值；
`chat_trace_events` 保存了 `input`、`model_response`、`tool_call` 和 `tool_result`，
公开聊天详情未返回工具事件，删除会话后相关 trace 级联删除。

## 风险和停止条件

- 如果 LangGraph 当前锁定版本不能按设计传递 typed runtime context，先调整技术方案并重新审批，不得将 writer 塞入 Graph state 或引入 LLM 到 ChatRecords 的反向依赖。
- 如果工具结果无法安全脱敏或超过已确认上限，停止写入并使 Graph 按已批准失败策略结束。
- 如果历史重建会产生不匹配的 tool call/result，不能发送不完整消息序列给模型。
- 如果同一 conversation 的并发请求导致事件顺序不确定，先阻止并发冲突并补足一致性设计，不得静默保存错序记录。
- 如果公开响应中出现 `tool_call`、参数、结果或内部错误，停止发布并修复权限/映射。
- 如果流式工具参数聚合不完整却执行工具，停止发布并补充消息块聚合和解析保护。
- 如果迁移会造成现有聊天历史丢失或删除不级联，停止迁移并更新方案。

## 实施审批门槛

本实施文档已确认并完成实现；实现结果以代码、测试和迁移文件为准。

本实施文档及其阻塞决策已获确认，可以按文件所有权拆分并开始阶段 1。
