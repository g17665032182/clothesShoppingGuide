# 对话偏好管理页面请求实施文档

## 状态与依据

- 状态：已确认；已实施并完成自动化验证。
- 最后更新：2026-11-16。
- 前置确认：[设计文档](./chat-tool-preference-form-design.md)、[偏好请求 CRUD 契约](../../contracts/chat-tool-preference-form-crud-contract.md)和[技术文档](./chat-tool-preference-form-technical.md)已确认。
- 领域契约：[用户偏好 CRUD 契约](../../contracts/user-preferences-crud-contract.md)。
- 验证约定：[后端](../../development/backend.md)、[前端](../../development/frontend.md)、[安全与业务边界](../../development/security-and-business-boundaries.md)、[环境与验证约定](../../development/validation.md)和[项目全量验证计划](../../testing/project-full-validation-plan.md)。

本文只规划已确认技术方案的实现顺序、代理所有权和验收。不增加工具能力或改动数据/API 契约。

## 交付范围

- 在 SSE 工具集中注册 `request_preference_form`，将经过白名单校验的请求转成一次性 `preference-form` 事件。
- 在 Web SSE 类型、解析器和聊天运行时状态中接收、绑定、去重并消费该事件；只导航到固定的 `account-memories` 偏好视图。
- 复用既有偏好类别和筛选能力，使合法 `category` query 可预选类别；无效 query 规范化为无筛选。
- 对工具历史和 trace 做安全投影，避免原始参数、异常和表单值泄漏。
- 增加后端单测、前端可运行的定向检查及 API 端到端隔离测试；同步能力清单和验证记录。

不新增依赖、HTTP 路由、Entity、迁移、CRUD、动态表单、偏好读取/写入能力、JSON 导航支持或跨会话持久化。真实模型和供应商调用不属于自动化验收。

## 接口冻结

实施开始前，主代理与各负责人确认以下接口，不使用假成功占位实现：

| 接口             | 约定                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| 工具 schema      | `z.strictObject({ category: preferenceFormCategorySchema.optional() })`；仅九类类别，无身份、会话、资源或 URL 字段 |
| 工具回调         | 解析成功后同步调用本轮 `onRequested(category?)`，再返回固定安全状态；回调异常映射为固定 unavailable                |
| 本轮事件状态     | 仅保存在 `PreparedChat` 运行时上下文；首次有效请求胜出，每轮至多发一个事件                                         |
| SSE              | 事件名 `preference-form`；payload 为严格对象，只允许缺省或合法 `category`；不进入 display envelope                 |
| Web pending 状态 | 绑定发起事件的会话和本地 request id；只存在内存中，导航成功、失败或丢弃后清理                                      |
| 导航             | 固定命名路由 `account-memories`，`view=preferences`，类别只作为筛选 query；不接受模型 URL                          |
| 页面筛选         | route query 是权威状态；用户筛选用 `router.replace` 同步；记忆文档视图忽略类别                                     |
| Trace 投影       | 只保留工具名、合法类别及固定结果状态；独立、嵌套、异常调用均按白名单处理                                           |

若现有 API 或前端实现与以上端口不符，负责人先报告证据，由主代理裁决并同步全部依赖方；不得私自扩展事件协议或改变类别集。

## 子代理角色和文件所有权

实施批准后使用三个并行子代理，每个代理只修改其下列文件。未列出的文件归主代理；同一文件不设置多个写入者。

### A：后端工具与 SSE 运行时

独占范围：

- 新增 `apps/api/src/chat-records/tools/request-preference-form.tool.ts`。
- `apps/api/src/chat-records/service/chat-records.service.ts`。
- `apps/api/src/chat-records/spec/chat-records.service.spec.ts`。
- 新增工具对应的 `apps/api/src/chat-records/spec/request-preference-form.tool.spec.ts`。

负责严格工具 schema、工具描述、SSE-only 注册、PreparedChat 一次性状态和流迭代边界事件发射。不得编辑 trace writer、历史 mapper、Web 文件、共享根配置或集成测试。

验收：工具 schema 覆盖空对象、九类和非法输入；JSON 工具集中无此工具；SSE 每轮只发首次有效请求且不写展示 envelope；回调在首个异步操作前执行，异常不泄漏。

### B：聊天 trace 与历史安全边界

独占范围：

- `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`。
- `apps/api/src/chat-records/history/chat-history.mapper.ts`。
- 上述文件各自所属的 spec 文件（以仓库实际路径为准）。
- 如 activity 白名单有独立模块，仅可修改其对应实现和所属 spec；开始前将确切路径登记到本表并通知主代理。

负责对新工具调用、结果、嵌套调用和非法调用实施允许字段投影，并把工具调用/结果成对加入隐藏历史名单。不得修改 `chat-records.service.ts`、工具实现、Web 或 API 集成测试。

验收：trace 只保留固定工具名、合法类别和固定状态；自由文本、原始参数、用户/会话标识、异常和未知键不落库；历史恢复时调用和结果均隐藏；既有工具投影保持不变。

### C：Web SSE 消费与偏好筛选

独占范围：

- `apps/web/src/api/modules/chat.ts`、`apps/web/src/api/types/chat.ts` 及聊天 SSE parser 所属 spec（若有）。
- `apps/web/src/stores/chat/index.ts`、`session.ts`、`turn.ts` 及其所属 spec（若有）。
- `apps/web/src/pages/chat/` 中消费运行时导航请求的页面/逻辑及所属 spec。
- `apps/web/src/pages/memories/page.ts`、`use-preferences.ts` 及所属 spec。

负责严格解析事件、按发起会话隔离一次性请求、过期/重复事件丢弃、固定路由导航和 Toast、类别 query 的解析/同步/规范化。不得修改 API 后端、共享根配置或集成测试。

验收：事件仅在原会话仍有效、仍为活动会话且身份未变时导航；页面卸载、切换账号/会话或目标会话失效不产生陈旧导航；重复消费不重复 push；所有类别 query 筛选正确，非法/数组/重复 query 不筛选并规范移除；不读取或预填偏好值。

### 主代理：公共接线、跨模块集成和文档

独占范围：

- 新增 API 隔离集成 spec，例如 `apps/api/src/chat-records/spec/chat-preference-form.postgres.spec.ts`。
- `docs/modules/llm/chat-tool-capability-inventory.md`、`README.md`、`docs/testing/project-full-validation-plan.md` 和本任务设计/契约/技术/实施文档。
- 公共 Module/应用装配、锁文件、包脚本及其他跨模块文件（若确有必要）。

主代理负责确认端口、维护共享文件、检查代理差异、集成真实 SSE HTTP + ToolNode 路径、执行最终验证及更新实际交付记录。若无必要，不改包依赖、脚本或根配置。

## 子代理开始前检查

主代理在本文确认后、派发任务前执行：

1. 记录新的 `git status` 与实施涉及文件的现有差异；保留本文和其他所有未提交用户修改。
2. 重读设计、契约、技术文档与本实施文档，以及当前聊天工具、SSE parser/store、偏好页面和 trace/history 源码；不以文档路径假设当前文件存在或行为未变化。
3. 核对本地 Zod、LangChain、Nest、Pinia、Toast、router 和 SSE 实现及安装版本；只有依赖变化或 API 不确定时查阅相应官方文档。不新增测试框架。
4. 按表确认 A/B/C 的精确文件清单、公开回调与事件类型；任何路径重叠先重新拆分。
5. 检查 API 测试门控、具名隔离 PostgreSQL 的消费变量、ORM dbName 注入和清理逻辑；确认目标库不存在、不同于默认库后才可创建。
6. 固定本轮使用的合成用户、会话和类别 fixture；不使用真实偏好内容或账号数据。

若找到设计歧义、偏好数据会进入模型/trace、路由能由模型控制、模块依赖私有实现，或需要改 CRUD/权限/数据库，立即停止相关代码工作并回到受影响的设计/契约阶段。

## 子代理完成报告

每个代理完成时按以下格式报告，主代理审阅差异并确认没有越界后才集成：

```text
修改文件：
执行命令：
测试结果（通过/失败/跳过/未执行）：
公开接口或接线要求：
未解决风险：
越界修改（没有则写无）：
```

代理不得自行提交、清理他人改动、运行共享数据库或占用共享端口的测试。遇到接口变化或需修改他人文件时先停止并交由主代理协调。

## 按顺序排列的实施阶段

| 阶段              | 负责人                     | 工作与退出条件                                                                                         |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0：基线与端口冻结 | 主代理                     | 检查 Git、当前源码、依赖、隔离库门控；工具回调、事件、payload 和 request 生命周期一致                  |
| 1：独立组件       | A、B、C 并行               | 各自完成独占文件及定向单测；不依赖跨代理文件的临时占位实现                                             |
| 2：接口对齐       | 主代理 + 相关负责人        | 审阅 schema、状态生命周期、trace 白名单和路由类型；任何变更同步给其他负责人                            |
| 3：跨层集成       | 主代理                     | 增加实际 SSE HTTP、认证、ToolNode 与 fake model 的隔离数据库用例，确认事件消费与历史/trace 边界        |
| 4：定向回归       | 各代理完成后主代理串行整合 | 跑 A/B/C 定向测试、API 全量测试和 Web 类型检查；修复接口回归后重跑受影响项目                           |
| 5：质量与运行验收 | 主代理                     | 依序执行格式、类型检查、构建、`pnpm check`、`git diff --check`；可安全提供受控登录态时再做浏览器 Smoke |
| 6：交付记录       | 主代理                     | 已完成：更新文档状态与真实结果，列出通过、失败、跳过、未执行、数据库清理及浏览器缺口                   |

数据库、迁移、API 服务、浏览器会话和共享构建目录均由主代理串行使用；单元测试可并行，但不得同时使用共享输出目录。

## 验收标准

### 工具与事件

- `{}` 与九类合法类别通过；非法类别、`null`、未知键和伪造身份/会话/URL 被拒绝。
- 工具只注册于 SSE 工具集；JSON 聊天行为不变。
- 同一轮只接受并发/重复调用中的首次有效请求；事件 payload 严格、一次性且不进入展示 envelope。
- 客户端没有确认导航成功的通道时，模型只收到请求已接受，不得收到或声称“页面已打开”。

### Web 生命周期与路由

- parser 拒绝错误 JSON、额外键和非法类别；不合法事件不导航。
- 请求始终绑定到生成它的本地会话及账号身份；切换或失效后丢弃，不跨刷新恢复。
- 导航只使用固定 `account-memories` 命名路由和 `view=preferences`。
- 成功/失败使用固定 Toast；不插入伪造 assistant 消息，不把导航结果持久化。
- query 只筛选列表，不自动打开编辑器、创建表单或预填值；非法 query 清理且记忆文档视图不受影响。

### 隐私、兼容性和测试

- 不访问偏好 CRUD/reader，不改变设置开关、偏好权限或用户数据。
- trace/activity/history 只保留批准的白名单；异常和自由文本不泄漏。
- 回归购买表单工具、动态表单、聊天 SSE、历史恢复、偏好筛选及偏好 CRUD。
- 无 Entity、Migration、API route、依赖和新增环境变量。

## 计划验证命令

实施期间先运行各自所属的定向 spec，集成后由主代理运行：

```bash
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web build
pnpm check
git diff --check
```

执行共享构建输出的命令时串行运行。API 全量测试的默认 skipped 门控项不计作通过；新增 PostgreSQL 集成测试须使用代码验证过的 `RUN_*` 开关和具名隔离库。确认测试目标、dbName 注入及清理范围前不启动数据库用例，不运行默认库 `migration:fresh`。命令为计划，不代表已执行。

当前 Web 未批准安装 Vitest、Vue Test Utils 或 Playwright；先使用既有 lint/typecheck/build 和可用测试设施。若没有安全的登录态浏览器 harness，浏览器交互列为未执行，不将构建或 API 测试描述为浏览器验收。

## 风险和停止条件

- 事件目标、payload、类别来源或路由发生变化：暂停实现，主代理判断是否需重新确认设计/技术方案。
- 需要 JSON 导航支持、偏好值读取/写入、API/迁移、自动打开编辑器或跨会话草稿：超出已确认范围，停止并回到设计与契约审批。
- SSE parser 或聊天 store 不能保证按任务会话绑定时，不得退化为全局 pending flag。
- trace writer 不能在持久化边界安全投影模型原始 tool args 时，暂停集成并补充测试；不以提示词或仅修改 activity 代替。
- 目标数据库不明确、已有库归属不明、清理范围无法验证或门控会消费默认配置库时，停止数据库验证并报告。
- 任何代理工作区差异越过文件所有权、并行共享构建目录、或与用户新改动冲突时，先停止相关任务并协商移交，不覆盖或回滚用户工作。

## 文档清单与阶段审批

本功能文档集：

- [设计文档](./chat-tool-preference-form-design.md)：已确认。
- [CRUD 契约](../../contracts/chat-tool-preference-form-crud-contract.md)：已确认。
- [技术文档](./chat-tool-preference-form-technical.md)：已确认。
- 本实施文档：已确认并完成实施。
- [领域偏好 CRUD 契约](../../contracts/user-preferences-crud-contract.md)：既有契约，本功能不修改其数据和 API 语义。

2026-11-16：用户确认本实施文档，进入 A/B/C 分工实施阶段。主代理负责集成、公共文档和最终验证。
