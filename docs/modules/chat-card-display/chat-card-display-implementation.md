# 聊天通用卡片展示实施文档

## 状态与依据

- 状态：已由用户确认并完成实现；验证和未执行项见本文末尾。
- 设计文档：[聊天通用卡片展示设计](./chat-card-display-design.md)。
- 技术文档：[聊天通用卡片展示技术文档](./chat-card-display-technical.md)。
- CRUD 契约：[聊天卡片展示 CRUD 契约](../../contracts/chat-card-display-crud-contract.md)。
- 最后更新：2026-11-12。

实施文档已确认；本文件只约束本功能的实施范围和验收，不代表功能已完成。

## 实施范围

本次交付实现以下链路：

- 助手调用 `display_chat_card`，只提供模板名和本轮领域查询结果中的引用。
- 服务端从本轮来源登记器物化卡片 JSON，使用严格 schema、字段白名单和现有字节预算验证。
- SSE 与同步聊天响应都携带卡片；历史卡片通过 `publicDisplay` 与 assistant 消息绑定后恢复。
- 聊天 Markdown 展示层按 `type` 和固定 `name` 注册表渲染商品及订单模板。
- LLM trace 写入工具参数与结果的专用安全投影；activity 不回显原始卡片结果。
- 订单卡首版只读；商品购买、翻页及现有订单操作继续沿用已有页面事件和服务端授权。

本次不新增 HTTP API、Entity、Migration、依赖或前端测试框架；不迁移或删除现有 `productResults`、`orderCancellationCandidates`、`purchase` 展示结构。

## 开始前检查

1. 实施开始时从 `main` 创建本功能分支；先检查分支是否已存在及其提交基点，不覆盖既有分支。
2. 当前检查到的工作区已有修改包括 `apps/api/src/chat-records/spec/chat-display.postgres.spec.ts`、`docs/contracts/README.md` 和 `docs/contracts/chat-records-crud-contract.md`，另有本功能的未跟踪文档。重新检查当时的 `git status`，区分并保留所有已有改动；不要用切换、重置、暂存或清理命令覆盖它们。
3. 阅读本文件、设计/技术文档、相关 CRUD 契约、`AGENTS.md`、README 和现有聊天工具/展示/trace 实现。
4. 记录基线分支、提交、工作区状态及检查结果。若用户的未提交改动与目标文件冲突，先审阅并以增量方式协作；无法分离时暂停并报告。
5. 主代理先冻结卡片类型、Zod schema、来源登记器与领域工具回调之间的窄接口，再派发平行任务；代理不得各自修改共享接口。

## 代理角色与文件所有权

| 负责人                     | 独占修改文件                                                                                                                                                                                                                                                                                                                                                                                                               | 任务和边界                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 代理 A：领域工具与来源登记 | `apps/api/src/product-catalog/tool/product-search.tool.ts`、`apps/api/src/product-catalog/spec/product-catalog-import.schema.spec.ts`、`apps/api/src/orders/tool/list-user-orders.tool.ts`、`apps/api/src/orders/spec/order-query-tool.spec.ts`、新增 `apps/api/src/chat-records/display/chat-card-source-registry.ts`、新增 `apps/api/src/chat-records/display/chat-card-display.tool.ts`、新增对应的聊天卡片工具单元测试 | 为商品/订单安全结果增加窄回调；实现请求级来源登记和引用校验；只允许从已登记结果物化卡片。不得依赖其他业务模块的 Entity/Repository，不得编辑 ChatRecordsService、展示投影/服务、trace writer、前端或共享 schema。 |
| 代理 B：Web 协议与模板     | `apps/web/src/api/types/chat.ts`、`apps/web/src/api/modules/chat.ts`、`apps/web/src/stores/chat/turn.ts`、`apps/web/src/pages/chat/components/ChatAssistantMessage.vue`、新增 `ChatMarkdownRenderer.vue`、`ChatCardTemplate.vue`、商品/订单卡片模板组件                                                                                                                                                                    | 接入实时与历史卡片类型、事件校验、消息状态归并和固定组件注册表；交互只通过已声明 Emits 交还现有父组件处理。不得编辑通用 `MarkdownRenderer.vue`、后端文件、依赖清单或测试基础设施。                               |
| 主代理：服务端投影与集成   | `apps/api/src/chat-records/display/chat-display.types.ts`、`chat-display.projection.ts`、`chat-display.service.ts`、`service/chat-records.service.ts`、`chat-records.module.ts`、`trace/chat-trace-writer.service.ts`、`history/chat-history.mapper.ts`、`dto/chat-history-response.dto.ts`、控制器响应元数据（如需）、相关 chat-records 单元及集成测试                                                                    | 冻结并维护服务端 schema/类型；接线工具与来源登记；实现 SSE、同步响应、历史投影、trace 安全投影和事务绑定；负责跨模块集成、冲突处理及最终验证。不得覆盖已有用户改动。                                             |

代理仅能编辑表格列出的文件。新增测试文件应在开工前声明归属；共享 schema、模块注册、ChatRecordsService 和根配置归主代理。若实际目录或接口必须调整，先向主代理说明，不自行扩展文件所有权。

## 开发阶段

### 1. 主代理冻结共享接口

- 定义服务端 `ChatCard` 联合类型、卡片 envelope schema 和来源登记接口。
- 固定商品查询回调、订单查询回调及展示工具的输入/输出类型；业务模块只接收窄回调，不导入聊天记录模块。
- 冻结预算和失败处理：每卡至多 5 项、整个展示 envelope 不超过 16 KiB；拒绝不合规卡片，不截断业务字段。
- 提交给代理 A、B 的任务说明包含确认过的文档、独占文件列表、禁止修改边界和验收要求。

### 2. 平行实现边界内任务

- 代理 A 实现商品/订单工具安全结果登记、`display_chat_card` 参数校验、引用验证和工具单测。
- 代理 B 实现 `card` SSE/历史数据的前端类型校验、reducer 接入、聊天 Markdown 包装组件和 `product` / `order` 模板。
- 主代理实现服务端展示数据类型、schema、投影、trace 安全投影和显示数据服务；不编辑代理 A、B 的独占文件。

如代理 A 的结果登记需要访问来源模块私有实现，立即停止并改为使用模块公开结果或窄回调，不跨模块读取 Entity/Repository。

### 3. 主代理集成

- 在 `ChatRecordsService.tools(prepared)` 为每轮创建来源登记器，接入领域工具和卡片工具。
- 流式路径仅在服务端 schema、来源和预算检查通过后发出 `card` 事件；保留既有 SSE 事件语义。
- 同步聊天路径从相同请求级登记器读取并校验卡片，保证同步响应、流式响应和历史读取一致。
- 扩展 assistant 消息 `publicDisplay` 与历史响应 DTO；旧 envelope 缺少 `cards` 时回退为空数组，不新增数据库列或表。
- 确认 `publicDisplay` 仍在最终 assistant 消息事务内绑定，trace writer 对卡片工具参数/结果使用专用安全投影；禁止原始异常和敏感字段进入公开响应、activity、日志或 trace。
- 将卡片传入聊天 Markdown 展示层，保持正文优先、卡片按工具调用顺序后置。未知模板安全忽略；订单模板保持只读。

### 4. 代理报告与集成审查

每个代理完成后提交：

```text
修改文件
执行命令
通过、失败、跳过及未执行项
未解决风险
越界修改
```

主代理逐项审阅 diff 和验证证据。代理未报告的文件、未执行的测试和被跳过的断言均不能视为已完成；整合时不回滚已有工作。

## 验收标准

- 商品和订单卡片均由 `display_chat_card` 请求并返回 `{ type: "card", name, data }`。
- 工具只能选择当前聊天轮次领域工具已返回的引用；服务端从来源记录重建卡片，拒绝模型提供的价格、库存、状态或任意业务对象。
- API schema 和 trace 写入采用严格字段白名单；非法工具结果不回显原文，activity 不含原始工具载荷。
- SSE、同步聊天 JSON 和历史读取使用一致的卡片类型与安全投影，历史卡片绑定到正确的 assistant 消息。
- 缺失字段的旧历史正常读取；损坏数据、未知 `type`/`name`、未知字段、预算超限均安全降级。
- Markdown HTML sanitize 保持开启；组件注册表不动态加载；卡片数据不生成可执行操作。
- 商品卡交互沿既有事件链运行；订单卡只读，不改变订单查询、取消、支付或确认收货的授权和确认规则。
- 兼容性、窄屏、键盘和屏幕阅读器行为通过代码审查与浏览器 smoke test 验收；未执行的场景明确列为缺口。

## 验证与验收顺序

1. 运行代理各自的定向单测与格式检查，审阅改动边界。
2. 执行 `pnpm format:check`、API typecheck、API test、API build、Web typecheck 和 `pnpm check`。
3. API 测试运行前核对测试源码里的 `RUN_*` 门控、数据库变量、派生数据库名和清理逻辑。PostgreSQL/HTTP 测试只使用具名可销毁数据库，相关初始化、迁移、测试和清理串行执行；禁止对默认开发库运行 `migration:fresh`。
4. 报告 API 测试实际通过/失败/跳过数量。未设置门控的测试记为未验证；`pnpm check` 不替代 API 测试。
5. 在可用本地环境执行聊天 smoke test：模型展示商品卡、展示本人订单卡、触发未知/不合法卡片降级、断开流后检查状态、刷新后核对历史恢复；检查订单卡不能触发写操作。
6. 验证桌面和窄屏布局及键盘操作。项目目前没有获准的 Playwright/Vitest/Vue Test Utils 基础设施，不自行安装；若无法完成认证浏览器流程，明确报告该缺口。
7. 最后运行 `git diff --check`、核对 `git status` 和全部差异，确认没有丢弃用户修改或加入不相关文件。

## 风险与停止条件

- 如果必须新增 Entity、Migration、数据库字段、HTTP 查询 API 或改变已确认的授权/订单规则，停止实现并回到设计/契约阶段重新确认。
- 如果卡片无法仅凭本轮安全领域结果物化，不能退化为信任模型传入的任意 `data`；暂停并由主代理提出新的技术方案。
- 如果 `display_chat_card` 的原始结果无法通过 trace writer 白名单投影，停止该工具接线；不能把原始载荷加入活动、日志、公开响应或工具 trace。
- 如果 16 KiB 展示预算与现有来源、订单候选、购买引用或上下文预算冲突，拒绝新增卡片并保留其他消息内容；不得静默截断业务字段。
- 如果前端组件需要执行订单动作，停止该交互设计并复用现有订单操作 UI、本人授权检查和确认流程。
- 如果用户既存改动与实施文件发生冲突且无法安全增量合并，保留工作区并向用户说明，不重置、不覆盖。

## 实施状态

### 实施结果

- 状态：功能已实现；未提交、未合并。
- 分支：`feature/chat-card-display`，从本地 `main` 的 `0e6f81d` 创建。
- 已实现：请求级商品/订单安全来源登记、`display_chat_card` 引用校验、卡片 schema/预算、独立 SSE `card` 事件、assistant 消息 `publicDisplay` 历史绑定、trace 白名单投影，以及 Web 历史/SSE 校验和商品/只读订单模板。
- 保留原有商品结果、购买和取消候选展示；订单卡不提供写操作。

### 验证记录

- `pnpm format:check`：通过。
- `pnpm --filter @clothes-shopping-guide/api typecheck`：通过。
- `pnpm --filter @clothes-shopping-guide/web typecheck`：通过。
- `pnpm --filter @clothes-shopping-guide/api build`：通过。
- `pnpm --filter @clothes-shopping-guide/api test`：274 通过、15 跳过、0 失败。
- 卡片相关定向测试：46 通过、0 失败。
- `pnpm check`：通过，包含全仓格式检查、类型检查和构建。
- `git diff --check`：通过。

### 未执行项

- PostgreSQL 和真实 HTTP/SSE 集成测试由 `RUN_*` 门控跳过；本轮未启用门控，也未操作数据库。Docker daemon 当前不可用。
- 认证浏览器 smoke test、桌面/窄屏、键盘及屏幕阅读器验证未执行；仓库没有获准的前端测试基础设施。
- 未连接真实模型供应商；商品/订单卡真实模型调用流程尚未端到端验证。

实现范围、集成与验证均已完成；后续提交或合并需另行执行。
