# 后端系统上下文实施文档

## 文档信息

- 关联设计文档：[后端系统上下文设计](./system-context-design.md)
- 关联技术文档：[后端系统上下文技术文档](./system-context-technical.md)
- 关联契约：[聊天记录 CRUD 契约](../../contracts/chat-records-crud-contract.md)
- 状态：已确认并实施
- 所属应用：`apps/api`
- 最后更新：2026-11-02

## 实施目标

按已确认的设计和技术方案，将固定系统上下文接入所有面向用户的聊天调用；拒绝客户端提交的 system 消息或其他系统指令字段；确保系统上下文不会进入聊天记录、内部 trace、历史摘要或 API 响应。

不新增数据库结构、依赖、环境变量、HTTP 路由或用户记忆能力。

## 开工前检查

开始代码修改前：

1. 检查 `apps/api/package.json`、当前 DTO、`LlmService`、`ChatContextService`、`ChatRecordsService`、`ChatSummaryService` 和相关测试，确认可复用的消息类型、Token 计数器、Fake Chat Model 与测试脚本。
2. 查阅本地 `@langchain/core`、`@langchain/langgraph`、Zod 和 Nest 标准校验 Pipe 的已安装版本及项目用法；优先沿用现有依赖能力，不重复实现消息类型或校验逻辑。
3. 只有确认当前本地依赖不具备必要能力时，才调查并阅读合适的官方开源库文档；优先采用已有框架或库能力。
4. 只有本地依赖与合适的成熟开源库均无法满足需求时，才新增最小的项目内实现；本方案预期无需新增依赖。
5. 检查 `git status`，保留工作区中已有的用户修改。

## 文件范围与职责

实施范围仅限 `apps/api` 中的 LLM、聊天记录调用边界及其测试：

| 文件                                                          | 变更职责                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/api/src/llm/context/system-context.md`                  | 维护角色职责、禁止行为、输出要求和流程入口                                |
| `apps/api/src/llm/context/shopping-flow.md`                   | 维护选购对话流程                                                          |
| `apps/api/src/llm/context/after-sales-flow.md`                | 维护退/换货对话流程                                                       |
| `apps/api/src/llm/context/system-context.ts`                  | 读取并组合三份系统上下文 Markdown                                         |
| `apps/api/src/llm/dto/chat.dto.ts`                            | 将客户端角色限制为 `user`、`assistant`，保留严格对象和长度校验            |
| `apps/api/src/llm/service/llm.service.ts`                     | 明确区分直接用户调用、已规划上下文调用和内部任务调用                      |
| `apps/api/src/chat-records/context/chat-context.service.ts`   | 将服务端 system 消息计入输入 Token 预算，排除在摘要来源和历史消息来源之外 |
| `apps/api/src/chat-records/service/chat-records.service.ts`   | 使用已规划上下文调用；不从客户端请求提取 system 内容                      |
| `apps/api/src/chat-records/service/chat-summary.service.ts`   | 使用内部任务调用，保留摘要专属 system 指令                                |
| `apps/api/src/llm/spec/chat.dto.spec.ts`                      | 覆盖 system、未知角色及额外指令字段的拒绝行为                             |
| `apps/api/src/llm/spec/llm.service.spec.ts`                   | 覆盖系统上下文注入、不可覆盖和内部调用隔离                                |
| `apps/api/src/chat-records/spec/chat-context.service.spec.ts` | 覆盖系统消息预算、裁剪保护及摘要来源排除                                  |
| `apps/api/src/chat-records/spec/chat-records.service.spec.ts` | 覆盖持久化聊天调用边界及记录隔离                                          |
| `apps/api/src/llm/spec/llm.controller.spec.ts`                | 确认公开入口使用严格客户端 DTO                                            |

根据实际调用点可调整测试文件归属；不得扩大到数据库迁移、前端、工具实现或记忆模块。

## 实施顺序

### 1. 固定上下文和客户端 DTO

- 在 LLM 模块中维护设计稿确认的角色职责、禁止行为和输出要求。
- 系统上下文分别从 `shopping-flow.md` 和 `after-sales-flow.md` 加载选购、退/换货流程；不添加空实现、配置开关或持久化结构。
- 工具规范和用户记忆仅保留未来扩展说明。
- 客户端 DTO 的消息角色只允许 `user`、`assistant`。
- 保持 `z.strictObject` 行为，使 system/未知角色、额外消息字段和额外系统指令字段均返回 `400`。
- 同步 Swagger DTO 对角色范围的描述；运行时校验继续以 Zod schema 为准。
- 确认 `/api/llm/chat`、`/api/chat/chat` 与 `/api/chat/chat/stream` 共用同一请求 schema。

### 2. 区分三类模型调用

- 无持久化历史的客户端聊天使用直接用户调用，由 `LlmService` 注入固定 system 消息。
- 持久化聊天先通过 `ChatContextService.prepare()` 将固定 system 消息纳入 Token 预算，再使用已规划上下文的 LLM 调用，避免遗漏或重复注入。
- `ChatSummaryService` 使用内部任务调用，仅携带摘要专属 system 指令，不叠加导购上下文。
- 不增加客户端可控制的注入开关；内部调用入口不暴露为 HTTP 参数。

### 3. 保证上下文不落盘

- 系统消息参与上下文 Token 计数，但不能被裁剪掉。
- 系统消息不得进入 `summarySource`、`messageSummarySource`、摘要 transcript 或后续历史重建。
- Graph 输入 trace 仍只记录 user 输入；模型 trace 不记录系统指令内容。
- 用户可见消息投影继续只保存 user 输入和最终 assistant 回复。
- 响应、SSE delta、日志、异常及会话数据均不包含系统上下文全文。

### 4. 测试和验证

- 使用现有 Node 测试运行器及 Fake Chat Model，不访问真实供应商、凭据或外部网络。
- 先执行 DTO、上下文规划、LLM Service 和聊天记录相关定向测试。
- 定向测试通过后，依次执行格式检查、API 类型检查、API 全量测试、API 构建和仓库检查。
- 检查最终差异，确认没有数据库、依赖、环境变量、路由或无关文件改动。

## 验收标准

- [ ] 所有客户端聊天入口传入 `system` 角色或其他未知角色时返回 `400`。
- [ ] 所有客户端聊天入口传入 `systemPrompt`、`systemContext`、`instructions` 等额外字段时返回 `400`。
- [ ] 面向用户的直接调用和持久化调用均向模型提供固定系统上下文，且不重复注入。
- [ ] 持久化聊天的 Token 预算计入系统上下文；上下文裁剪不会删除系统消息或当前用户消息。
- [ ] 摘要等内部调用保留自身 system 指令，不自动叠加导购上下文。
- [ ] 系统上下文不进入 `chat_messages`、`chat_trace_events`、历史摘要输入、API 响应或 SSE delta。
- [ ] 既有认证、权限、错误映射、流式事件顺序、历史摘要和持久化行为无非预期回归。
- [ ] 不新增数据库迁移、依赖、环境配置或 HTTP API。
- [ ] 新增必要代码注释使用中文，说明设计意图或复杂边界。

## 验证命令

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
git diff --check
```

## 风险和停止条件

- 直接调用、已规划上下文调用和内部任务调用必须显式分离，不能依赖隐式状态或客户端参数。
- 若现有 Graph trace、消息历史重建或摘要实现会捕获 system 消息，应先修正并验证隔离测试，不得以“当前没有泄漏”作为未经测试的假设。
- 如果实现发现必须新增数据库字段、公开配置接口或记忆能力，停止并回到设计文档和 CRUD 契约重新确认。
- 如果现有依赖能力不足，先报告缺口并查阅合适的官方库文档；未确认必要性前不新增依赖或自行造轮子。

## 实施记录

- 固定上下文由 LLM 模块的 `context/system-context.md` 维护，构建时复制并在服务端加载；持久化聊天在上下文规划时计入 Token 预算，摘要调用使用独立指令。
- 客户端请求通过严格 schema 限制角色和未知字段；系统消息不由客户端提供或写入聊天记录。
- 未新增数据库迁移、依赖、环境配置或 HTTP 路由。前端请求类型尚未同步收窄，服务端校验仍为准。
- 模型生成内容由模型决定；提示词约束不能保证模型绝不复述上下文或始终遵循模拟内容标记要求。
