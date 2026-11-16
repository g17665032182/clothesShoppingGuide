# 流式聊天模块实施文档

## 状态与上下文

- 状态：已确认
- 关联设计文档：[流式聊天模块设计文档](./chat-streaming-design.md)
- 关联 CRUD 契约：[流式聊天 CRUD 契约](../../contracts/chat-streaming-crud-contract.md)
- 关联技术文档：[流式聊天模块技术文档](./chat-streaming-technical.md)
- 所属应用：`apps/api`、`apps/web`
- 最后更新：2026-10-28

## 实施目标

按已确认的设计、接口契约和技术文档，完成聊天后端流式输出、前端 Axios 流式消费和真实会话联调。保留现有持久化模型、权限规则及非聊天业务，不新增数据库迁移。

## 文件所有权和边界

### 后端聊天与模型调用

允许修改：

- `apps/api/src/llm/llm.service.ts`
- `apps/api/src/llm/llm.graph.ts`（保留旧 JSON Graph，不承载 HTTP 流写入）
- `apps/api/src/llm/llm.service.spec.ts`
- `apps/api/src/llm/llm.graph.spec.ts`
- `apps/api/src/chat-records/chat-records.service.ts`
- `apps/api/src/chat-records/llm-chat.controller.ts`
- `apps/api/src/chat-records/chat-records.service.spec.ts`
- 必要时新增聊天流事件/传输专属类型及测试文件。

约束：

- 不让 `LlmModule` 依赖聊天记录 Entity 或 Repository。
- 不将数据库操作、会话归属或事务逻辑移入模型 Graph。
- `ChatRecordsService` 不接收 Express Response；Controller 是唯一 SSE 写入方。
- 不通过修改现有普通聊天、认证或用户管理模块绕开已确认设计。

### 前端 API 与页面

允许修改：

- `apps/web/src/api/index.ts`
- `apps/web/src/api/modules/chat.ts`
- `apps/web/src/api/types/chat.ts`
- `apps/web/src/pages/chat/page.ts`
- `apps/web/src/pages/chat/index.vue`
- `apps/web/src/pages/chat/mock-data.ts`
- `apps/web/src/pages/chat/components/ConversationSidebar.vue`
- `apps/web/src/pages/chat/components/ChatMessageList.vue`
- 必要时新增聊天页面私有组件和就近测试。

约束：

- 页面不得直接操作 Axios、解析 SSE 原始帧或拼接接口 URL。
- 页面使用字符串 UUID 和 ISO 时间，API 模块负责后端响应到页面视图模型的映射。
- 保留当前聊天页面布局、主题、侧栏折叠与主内容最大宽度设计。
- 不改无关页面和全局样式。

### 公共文件

主代理维护任何跨模块接线、`package.json`、锁文件、根配置、共享 API 错误/认证抽象和文档索引。

## 实施阶段

1. 重新检查工作区状态和当前模块实现，保留所有已有修改；确认 API、Web 包的类型检查、构建和测试基线。
2. 为 `LlmService` 增加基于现有 `BaseChatModel.stream()` 的可测试模型流能力；保留旧 `LangGraph.invoke()` JSON 路径，验证 chunk 顺序、文本标准化、用量聚合及错误映射。
3. 实现后端流服务预校验和领域事件：读取归属与历史、准备上下文、生成 start、发送 delta、聚合完整回复、事务保存、最后发送 done。
4. 实现 `/api/llm/chat/stream` Controller：预校验后设置 SSE headers、帧编码、背压、响应前后错误区分、断连监听及资源清理；保留 `/api/llm/chat` 原 JSON Controller 行为。
5. 完成后端单元测试，覆盖成功、新会话、已有会话、模型错误、事务错误、取消、越权和错误帧。
6. 扩展 Axios 底层 API 请求能力，确保流请求显式使用 Fetch adapter，验证 stream response、401 单飞刷新、取消及统一错误映射；只在收到响应前重试。
7. 在聊天 API 模块实现会话列表/详情/删除适配、SSE 字节帧解析和事件校验；用定向测试覆盖任意分片和 UTF-8 解码。
8. 改造页面状态和组件接线，加载真实会话及历史、增量更新 assistant 占位、处理完成/失败/取消，并移除用不到的 mock。
9. 完成前端类型检查和构建；通过手工联调确认无跨会话旧响应污染及重复发送问题。本次不新增前端测试基础设施。
10. 更新 Controller Swagger 装饰器和 `/api/docs-json` 验证，描述 `/api/llm/chat/stream` 的 SSE 成功响应及 HTTP 错误。
11. 依次运行格式检查、API 测试/类型检查/构建、Web 类型检查/构建及 `pnpm check`。
12. 运行真实本地 Smoke Test：认证、首轮新会话、增量输出、历史刷新、继续对话、模型失败、用户取消、状态未知核实和管理员既有读取行为。
13. 更新本实施文档验收结果和剩余风险，汇总变更及实际执行的命令。

## 验收标准

- [x] 后端按序发送 delta，且只有事务保存成功后才发送 done。
- [x] 单元测试覆盖事务保存前不写入消息、事务失败不发送 done。
- [x] 本地真实 API Smoke Test 验证取消后新会话未落库；事务开始后的断连竞速仍按状态未知处理。
- [x] 前端使用 Axios Fetch adapter 增量读取 SSE，继续复用访问令牌刷新逻辑；代码已完成并通过类型检查/构建。
- [x] 原 `/api/llm/chat` JSON 路由保留，新流式路由在 `/api/docs-json` 可见。
- [x] 本地真实 API Smoke Test 验证注册、流式事件、`done` 后历史详情包含 user/assistant 两条消息。
- [ ] 浏览器端会话侧栏交互、Axios 401 Refresh Token 重试及页面切换/卸载隔离尚未做实机验证。
- [x] 普通用户归属查询继续使用原有 `userId` 过滤，管理员接口实现未改。
- [x] 未新增数据库迁移。
- [x] `/api/docs-json` 包含流式路由和 `text/event-stream` 响应说明。

## 本次验证记录

- `pnpm check`：通过，包含格式检查、API/Web 类型检查和工作区构建。
- `pnpm --filter @clothes-shopping-guide/api test`：通过，31 项测试。
- `git diff --check`：通过。
- `GET /api/health`：HTTP 200。
- `GET /api/docs-json`：HTTP 200；存在 `/api/llm/chat/stream`，成功响应类型为 `text/event-stream`。
- 本地真实流式请求：注册 HTTP 201，流式 HTTP 200，事件为 `start`、多个 `delta`、`done`；随后读取历史 HTTP 200，记录角色为 `user,assistant`。
- 本地取消请求：收到 `start` 后中止，新会话历史查询 HTTP 404。
- 未验证：浏览器页面交互、Axios 流式请求的 401 Refresh Token 重试、真实模型失败路径及现有会话继续对话。Smoke Test 创建的 3 个临时账号及关联会话已清理。
- 不安装未经确认的前端测试依赖；对所有未运行的测试、Smoke Test 或检查如实说明，不把文档验收项误报为已通过。

## 验证命令

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm check
git diff --check
pnpm --filter @clothes-shopping-guide/api exec tsx -e "..."
```

## 风险和停止条件

- 当前模型 provider 或 LangGraph 无法提供可靠的可取消流时，先停止并记录实际限制，不得宣称取消一定停止上游生成或计费。
- 如果实际模型 chunk 含非文本块，必须依据当前 provider 的官方类型和运行结果过滤或处理，不得把内部对象序列化给前端。
- 如果事务保存与 SSE 生命周期无法保证“提交成功后才发 done”，停止实现并调整技术方案，不能降低持久化保证。
- 如果真实服务、数据库或模型凭据不可用，只执行可完成的自动化验证，并明确联调阻塞项；不得泄露凭据。
