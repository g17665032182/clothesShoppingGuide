# Agent 项目速读

[文档总览](../README.md) · [开发规范](./README.md)

核对日期：2026-11-17。本页依据当前源码入口、模块装配、包脚本和已有交付记录整理，帮助定位任务；运行状态和验证结果仍需按任务确认。

## 接手顺序

1. 先读根 [AGENTS.md](../../AGENTS.md)，执行 `git status --short`，保留已有修改。
2. 阅读下方“项目与链路”，通过“按任务定位”找到负责模块，不必通读所有历史设计。
3. 修改前读取对应领域规范、当前契约及相关增量，再读源码和实施文档中的交付记录。只有追溯决策时才展开完整 PRD、设计和技术方案。
4. 根据任务选择验证方式，报告实际执行与剩余缺口；命令以各包 `package.json` 为准。

契约描述已约定的行为，源码说明实际实现，带日期的执行记录说明验证过什么。三者有冲突时记录差异并核实，不根据旧计划直接补功能，也不把当前代码当作更改契约的授权。较大新业务沿用[模块开发工作流](../../.agents/skills/module-development-workflow/SKILL.md)的阶段审批，不重复询问已确认的决策。

## 项目与链路

这是服装购物助手：用户通过聊天查询商品、准备购买、管理本人信息及试穿，管理员查询商品和处理订单履约。

| 部分         | 当前职责与入口                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web          | Vue 3、Vite、shadcn-vue、Pinia、Axios；[应用入口](../../apps/web/src/main.ts)、[页面路由与访问控制](../../apps/web/src/router/index.ts)                          |
| API          | NestJS、Zod、MikroORM、PostgreSQL；[启动与全局校验](../../apps/api/src/main.ts)、[模块装配](../../apps/api/src/app.module.ts)                                    |
| 聊天编排     | [chat-records](../../apps/api/src/chat-records/chat-records.module.ts)负责会话、历史、上下文、业务工具装配、展示投影及持久化                                     |
| 模型执行     | [llm](../../apps/api/src/llm/llm.module.ts)负责模型配置、LangGraph、流事件和结构化生成能力                                                                       |
| 共享包       | [packages/shared](../../packages/shared/src/index.ts)当前为骨架；前后端请求类型分别维护，不假设已有统一 API 客户端或共享业务模型                                 |
| 环境与数据库 | [配置加载器](../../apps/api/src/common/config/environment.ts)、[ORM 配置](../../apps/api/src/mikro-orm.config.ts)、[迁移与 Seeder](../../apps/api/src/database/) |

普通页面沿 `pages → api/modules → api/index.ts → API Controller → Service → MikroORM` 请求。前端页面通常由 `index.vue` 组合界面，`page.ts` 或 composable 承载业务逻辑；后端各业务内部维护 `controller/`、`service/`、`dto/`、`entity/`、`spec/`。

聊天主链路：

```text
pages/chat → stores/chat → api/modules/chat.ts
  → chat-records/controller/llm-chat.controller.ts
  → ChatRecordsService：校验归属、准备上下文、装配本轮工具
  → LlmService / llm.graph.ts：模型与 ToolNode 循环
  → 展示投影、消息持久化 → SSE done → Store 核实历史并更新界面
```

- `POST /api/llm/chat` 和 `/api/llm/chat/stream` 的实际入口是 [LlmChatController](../../apps/api/src/chat-records/controller/llm-chat.controller.ts)。不要仅凭 `llm/controller/` 的文件名判断路由已注册。
- 业务工具在 [ChatRecordsService](../../apps/api/src/chat-records/service/chat-records.service.ts)按当前用户、会话和 JSON/SSE 场景装配；[tool-registry.ts](../../apps/api/src/llm/tools/tool-registry.ts)只覆盖基础配置工具。工具完整范围见[能力清单](../modules/llm/chat-tool-capability-inventory.md)。
- 前端生成任务属于 [stores/chat](../../apps/web/src/stores/chat/)，切换站内路由或会话时可继续；浏览器刷新、关闭后的任务恢复不由该 Store 保证。
- API 注册关系以 `*.module.ts` 为准，Web 入口以路由为准；文档目录名与源码模块不总是一一对应，例如管理员运营涉及 `users`、`product-catalog` 和 `orders`。

## 按任务定位

先按本表找到源码，再读对应契约。业务阶段文档统一从[模块索引](../modules/README.md)进入，LLM 增量和偏好记忆另有专题索引。

| 任务                                  | 主要源码                                                                                                                                                                                                                                                            | 契约或专题入口                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录、刷新令牌、资料、用户权限        | API [auth](../../apps/api/src/auth/)、[users](../../apps/api/src/users/)、[authorization](../../apps/api/src/authorization/)；Web [lib/auth.ts](../../apps/web/src/lib/auth.ts)、[路由](../../apps/web/src/router/index.ts)                                         | [用户与认证契约](../contracts/user-crud-contract.md)                                                                                                                              |
| 商品搜索、SKU、分页、商品试穿配置     | API [product-catalog](../../apps/api/src/product-catalog/)；Web [商品 API](../../apps/web/src/api/modules/product-catalog.ts)、[admin-products](../../apps/web/src/pages/admin-products/)                                                                           | [目录契约](../contracts/product-catalog-crud-contract.md)、[试穿配置契约](../contracts/product-try-on-setting-crud-contract.md)                                                   |
| 聊天、SSE、历史与上下文               | API [chat-records](../../apps/api/src/chat-records/)、[llm](../../apps/api/src/llm/)；Web [chat](../../apps/web/src/pages/chat/)、[stores/chat](../../apps/web/src/stores/chat/)                                                                                    | [记录契约](../contracts/chat-records-crud-contract.md)、[流式契约](../contracts/chat-streaming-crud-contract.md)                                                                  |
| 模型配置、提示词、工具执行            | [模型工厂](../../apps/api/src/llm/provider/chat-model.factory.ts)、[执行图](../../apps/api/src/llm/graph/llm.graph.ts)、[上下文加载](../../apps/api/src/llm/context/system-context.ts)、[本轮装配](../../apps/api/src/chat-records/service/chat-records.service.ts) | [LLM 专题](../modules/llm/README.md)、[工具能力清单](../modules/llm/chat-tool-capability-inventory.md)                                                                            |
| 聊天卡片、动态表单、用户信息          | API [display](../../apps/api/src/chat-records/display/)、[chat-dynamic-form](../../apps/api/src/chat-dynamic-form/)、[chat-user-information](../../apps/api/src/chat-user-information/)；Web [聊天组件](../../apps/web/src/pages/chat/components/)                  | [卡片](../contracts/chat-card-display-crud-contract.md)、[表单](../contracts/chat-dynamic-form-crud-contract.md)、[用户信息](../contracts/chat-user-information-crud-contract.md) |
| 购买草稿、地址选择、确认下单          | API [chat-purchase](../../apps/api/src/chat-purchase/)；Web [购买 API](../../apps/web/src/api/modules/chat-purchase.ts)、[聊天 Store](../../apps/web/src/stores/chat/)                                                                                              | [购买契约](../contracts/chat-purchase-crud-contract.md)                                                                                                                           |
| 订单、取消、支付、发货、库存协作      | API [orders](../../apps/api/src/orders/)、[order-catalog-coordination](../../apps/api/src/order-catalog-coordination/)和商品模块；Web [本人订单](../../apps/web/src/pages/account/orders/)、[admin-orders](../../apps/web/src/pages/admin-orders/)                  | [订单契约](../contracts/order-crud-contract.md)、[聊天取消](../contracts/chat-order-cancellation-crud-contract.md)、[管理员运营](../contracts/admin-management-crud-contract.md)  |
| 收货地址簿                            | API [user-addresses](../../apps/api/src/user-addresses/)；Web [addresses](../../apps/web/src/pages/account/addresses/)                                                                                                                                              | [地址契约](../contracts/user-address-crud-contract.md)                                                                                                                            |
| 穿衣偏好、Markdown 长期记忆、后台提取 | API [user-preferences](../../apps/api/src/user-preferences/)、[user-memory](../../apps/api/src/user-memory/)；Web [memories](../../apps/web/src/pages/memories/)                                                                                                    | [偏好契约](../contracts/user-preferences-crud-contract.md)、[记忆契约](../contracts/user-memory-crud-contract.md)、[专题阅读顺序](../modules/user-memory/README.md)               |
| 试穿照片、生成任务、私有文件          | API [virtual-try-on](../../apps/api/src/virtual-try-on/)、[聊天试穿调用](../../apps/api/src/chat-records/try-on/)；Web [my-try-ons](../../apps/web/src/pages/my-try-ons/)、[试穿 API](../../apps/web/src/api/modules/try-on.ts)                                     | [试穿契约](../contracts/virtual-try-on-crud-contract.md)、[聊天试穿](../contracts/chat-try-on-tool-contract.md)                                                                   |
| 请求重试、认证失效、错误提示          | Web [API 底座](../../apps/web/src/api/index.ts)、[认证状态](../../apps/web/src/lib/auth.ts)及[操作反馈规范](./frontend-feedback.md)；API [common](../../apps/api/src/common/)                                                                                       | [前端规范](./frontend.md)、[后端规范](./backend.md)                                                                                                                               |
| 环境、迁移、数据初始化、CI            | [配置加载](../../apps/api/src/common/config/environment.ts)、[database](../../apps/api/src/database/)、[API 脚本](../../apps/api/package.json)、[CI](../../.github/workflows/ci.yml)                                                                                | [启动说明](../../README.md)、[环境与验证规范](./validation.md)                                                                                                                    |

## 修改时保留的边界

完整规则见[安全与业务边界](./security-and-business-boundaries.md)，以下是跨模块改动最容易影响的部分：

- **模型上下文、内部 trace、公开聊天消息各自独立。** [上下文准备](../../apps/api/src/chat-records/context/chat-context.service.ts)、[trace 写入](../../apps/api/src/chat-records/trace/chat-trace-writer.service.ts)、[历史映射](../../apps/api/src/chat-records/history/chat-history.mapper.ts)、[展示投影](../../apps/api/src/chat-records/display/chat-display.service.ts)分别处理。新增工具须一并检查安全投影、历史恢复及记忆/摘要来源资格，不能把内部执行数据直接展示给用户。
- **业务动作由服务端验证并由用户确认。** 模型只具备已登记的查询、草稿操作和受限界面请求；正式下单、支付、取消、收货及照片授权保留在用户操作链路中。完整收件信息和私有图片数据不进入工具公开投影。
- **结构化偏好与 Markdown 记忆独立。** 偏好由用户 CRUD 维护，聊天自动提取写入长期记忆；旧偏好任务实体的存在不表示自动提取仍运行，实际 providers 以对应模块装配为准。
- **服务端读取提示词正文。** 运行文本来自 `apps/api/src/llm/context/` 的 Markdown，由 `system-context.ts` 读取；修改 `docs/` 中的说明或加文档链接不会直接改变模型上下文。
- **跨模块复用公开入口或 Port。** 请求校验沿用 Zod 与 Nest `StandardSchemaValidationPipe`；后端 TypeScript 相对导入保留 `.js`。前端请求、认证重试及错误提示复用现有底座。

当前尚不支持真实支付/退款、已付款取消、实时物流和通用后台商品编辑。试穿真实人像流程仍受供应商隐私确认约束；开发测试素材见[素材说明](../modules/virtual-try-on/fixtures/README.md)。

## 验证与证据

| 目的               | 入口或命令                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 本地启动           | 首次配置、迁移与 Seed 按 [README](../../README.md)；日常 `pnpm dev:db`、`pnpm dev`                                                     |
| 类型、格式与构建   | 根 `pnpm check`，包含格式检查、递归类型检查与构建                                                                                      |
| API 自动化         | `pnpm --filter @clothes-shopping-guide/api test`；不包含在 `pnpm check` 中                                                             |
| 数据库与迁移专项   | 先读[验证规范](./validation.md)和[门控与隔离库计划](../testing/project-full-validation-plan.md)，再查对应 `spec/` 的真实变量和清理逻辑 |
| 页面交互与外部服务 | 查看对应实施记录的覆盖范围；Web 当前没有项目内单元/组件或浏览器测试脚本，类型检查和构建不能代替交互验收                                |

配置优先级为进程环境变量 > `apps/api/.env.dev` > `apps/api/.env`。`migration:fresh` 会删库重建，只用于已确认可销毁的数据库；不得据启动失败对日常库执行它。CI 当前执行 `pnpm check` 和临时 PostgreSQL 的 `migration:fresh`，不等于运行了 API 全量业务测试。

以下是已有证据的阅读入口，不是本次重新执行的验收结论：

| 记录                                                                                                                                                                                                                     | 可支持的结论与限制                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [2026-11-11 全量执行与复测](../testing/project-full-validation-plan.md)                                                                                                                                                  | 记录当时的自动化、隔离数据库专项和修复结果；不能覆盖之后新增工具                               |
| [2026-11-12 进度执行记录](../testing/project-progress-improvement-plan.md)                                                                                                                                               | 有桌面登录态业务路径证据，同时记录窄屏缺陷和试穿供应商拒绝；不能理解为全量浏览器或真实生成通过 |
| [2026-11-16 第二阶段工具实施](../modules/llm/chat-tool-phase-two-implementation.md)                                                                                                                                      | 精确规格与本人偏好查询有自动化及隔离数据库记录，登录态浏览器未执行                             |
| [地址界面请求](../modules/llm/chat-tool-address-form-implementation.md)、[履约摘要](../modules/llm/chat-tool-order-fulfillment-implementation.md)、[购物规则](../modules/llm/chat-tool-shopping-rules-implementation.md) | 已有代码交付记录，业务测试或运行验收仍有暂缓项；类型检查与构建通过不能补足这些证据             |

命令、路由、模块职责或关键边界变化时，同步本页对应入口；验证证据保留在所属实施文档或测试记录中，避免在此复制会过期的测试总数。
