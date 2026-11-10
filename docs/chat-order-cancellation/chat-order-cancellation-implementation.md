# 聊天订单取消实施文档

## 状态与依据

- 状态：已确认。
- 实现状态：已完成（代码与自动化验证）。
- 前置审批：用户已确认[设计文档](./chat-order-cancellation-design.md)、[CRUD 契约](../contracts/chat-order-cancellation-crud-contract.md)及[技术文档](./chat-order-cancellation-technical.md)。
- 最后更新：2026-11-10。

## 交付范围

交付明确取消意图下的本人可取消订单查询、服务端可信聊天订单卡、已有本人取消 API 的确认弹框接入，以及对应安全投影、trace、提示文案和测试。

保持既有业务规则：只能取消本人未过期的 `pending_payment` 订单；用户必须在订单卡选择目标并在现有确认弹框中再次确认。模型只读，不增加取消写工具。

不交付已付款取消、退款、退货、换货、管理员代操作或真实支付。不新增公开 HTTP 路由、数据库字段/实体/Migration、运行时依赖或前端测试框架。不运行 `migration:fresh`，不写入默认开发数据库。

## 开发前检查

实施文档确认后，主代理在启动开发前：

1. 阅读 `AGENTS.md`、本业务设计/CRUD 契约/技术文档和现有订单、聊天购买、地址工具文档；复核设计边界没有被新需求改变。
2. 检查 `git status` 和各代理准备修改的文件差异，记录已有工作；工作区中本功能的文档保留，不作为清理目标。
3. 核对 API 与 Web 依赖版本、Node ESM `.js` 导入习惯、Zod 和现有 Nest 参数 schema 绑定、订单工具 trace 白名单、SSE 与公开展示 envelope。
4. 为各代理固定独占文件清单和展示/工具类型；跨模块公共类型由主代理先行评审，避免 API、trace、SSE、历史和前端各自定义字段。
5. 核对现有 API 单元/HTTP/PostgreSQL 测试脚本、隔离数据库命名规则、以及 `useChatOrder` 的身份切换、确认弹框、409 和未知结果行为。
6. 若现有取消状态规则、订单公开方法、可信卡片持久化边界或已确认字段必须改变，停止实现并回到受影响的最早设计/技术审批阶段。

## 子代理分工与文件所有权

本功能跨订单查询、聊天公开投影/trace 和前端聊天动作，实施阶段计划使用三个范围明确、文件互斥的子代理并由主代理集成。只有用户确认本实施文档后才启动。所有子代理必须阅读 `AGENTS.md` 及本业务已确认文档；不得修改其他代理所有文件、修改已确认业务规则、安装依赖或操作默认/生产数据库。新增必要代码注释使用中文，遵守原生 ESM `.js` 相对导入。

### A：订单可取消候选查询与工具

**独占文件：**

- `apps/api/src/orders/service/orders.service.ts`
- `apps/api/src/orders/tool/list-user-orders.tool.ts`
- `apps/api/src/orders/spec/orders.service.spec.ts`
- `apps/api/src/orders/spec/order-query-tool.spec.ts`
- `apps/api/src/orders/spec/orders.postgres.spec.ts`

**任务与验收：**

- 增加仅供服务端调用的本人可取消候选查询；查询条件绑定当前用户、`pending_payment`、数据库时钟下未过期，最多 5 笔并稳定排序。
- 返回订单卡所需的安全投影；不加载或返回 recipient、shipment、userId 或 Entity。
- 扩展现有只读工具，严格校验工具参数、处理空结果和错误；不增加取消、支付或收货写工具。
- 证明候选查询仅排除过期记录、不改变订单/库存状态；复用既有取消 Service 作为最终状态及到期校验。
- 报告修改文件、命令和结果、数据库是否实际运行、未解决风险及越界修改。

### B：聊天展示、历史恢复与隐私边界

**独占文件：**

- `apps/api/src/chat-records/display/**`
- `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`
- `apps/api/src/chat-records/spec/chat-display.service.spec.ts`
- `apps/api/src/chat-records/spec/chat-trace-writer.service.spec.ts`
- `apps/api/src/llm/context/system-context.md`
- `apps/api/src/llm/context/after-sales-flow.md`

**任务与验收：**

- 扩展结构化订单候选 SSE/display 类型、严格投影 schema、公开展示 envelope 兼容和字节预算。
- 仅在经过严格校验的只读工具结果上创建订单卡；普通 assistant 文本和工具 activity 不得产生操作按钮。
- trace 继续按工具名进行白名单脱敏，卡片历史只保留契约列出的允许字段。
- 更新模型上下文：明确取消意图可查询待付款本人订单；正式取消只由用户界面操作；明确退款、退货、换货尚不支持。
- 覆盖旧 envelope 缺字段、恶意/未知字段、过大投影、工具失败、trace 隐私与重复绑定。
- 报告修改文件、命令和结果、未解决风险及越界修改。

### C：聊天订单卡与取消确认交互

**独占文件：**

- `apps/web/src/api/types/chat.ts`
- `apps/web/src/stores/chat/turn.ts`
- `apps/web/src/stores/chat/index.ts`
- `apps/web/src/pages/chat/components/ChatAssistantMessage.vue`
- `apps/web/src/pages/chat/components/ChatMessageList.vue`
- `apps/web/src/pages/chat/page.ts`
- `apps/web/src/pages/chat/index.vue`
- `apps/web/src/components/shared/orders/useChatOrder.ts`
- `apps/web/src/components/shared/orders/OrderActionDialog.vue`（仅当复用确认弹框需要最小接线）

**任务与验收：**

- 解析并展示类型化 SSE/历史候选卡；不得从 Markdown、订单号文本或未验证 JSON 构造动作。
- 展示订单号、状态、商品规格摘要、金额和创建时间；隐藏收件/物流信息。
- 点击卡片取消入口时重新读取本人订单，仍可取消后直接打开已有取消确认弹框；不得先打开完整详情弹框，也不得自动提交。
- 确认后复用现有 `cancelOrder()`，成功以 API 响应更新卡片；409、未知结果和账号/会话切换按既有保护恢复。
- 保留 loading、empty、error、submitting、unknown 等状态和统一 Toast 规则，防止重复提交、过期响应和跨账号展示。
- 报告修改文件、命令和结果、未解决风险及越界修改。

## 主代理所有权与集成

主代理独占：

- `apps/api/src/chat-records/service/chat-records.service.ts` 及必要的聊天流集成测试。
- `apps/api/src/chat-records/spec/chat-records.service.spec.ts`、SSE/HTTP 集成测试；与 B 的测试文件严格区分。
- `apps/api/src/chat-records/chat-records.module.ts`、`apps/api/src/orders/index.ts` 等跨模块公开导出或 Nest 接线文件（只有确有需要才改）。
- `apps/web/src/api/types/index.ts` 及其他根级/共享导出（只有确有需要才改）。
- 本实施文档的实际交付记录和最终验证汇总；不得借集成改写已确认设计与契约。

主代理负责冻结跨模块候选、展示、SSE 和确认动作类型，审核 A/B/C 接口一致性，集成修改，处理冲突和隐私/授权复核，运行回归并记录真实结果。任何代理发现需要修改已确认范围时须暂停并报告，不得通过局部实现自行扩大契约。

## 实施顺序与退出条件

### 阶段 0：确认基线与冻结接口

- 用户确认本实施文档后，检查工作区和测试状态。
- 主代理固定 `OrderCancellationCandidate`、候选读取投影、SSE event、PublicDisplayEnvelope 字段及前端动作结果接口。
- 确认工具过滤到期的数据库时间边界和取消 API 最终校验语义。
- 每个子代理确认其文件清单，没有共享写权限。

退出条件：类型、字段、失败行为、身份来源和文件所有权一致；需要改变业务契约时停止。

### 阶段 1：并行实现独立模块

- A 实现候选读取、工具结果白名单投影和订单单元/PostgreSQL 测试。
- B 实现可信展示 schema、SSE/display/history、trace 脱敏及上下文提示和测试。
- C 实现前端卡片渲染、确认弹框编排、状态恢复和类型接线。
- 各代理只在冻结接口内工作；格式化限于各自修改文件，不批量重写共享工作区。

退出条件：各自局部 typecheck/测试通过，订单字段与展示 schema 对齐，不泄露收件/物流信息，不出现未经确认的写请求。

### 阶段 2：主代理集成与跨层测试

- 主代理接通聊天服务的展示 event 和消息历史恢复，保证新 SSE 分支不改变 `start/delta/activity/done/error` 顺序与最终 `done` 行为。
- 验证最终模型消息与安全 `publicDisplay` 绑定、重试/取消/断流时无伪造卡片成功。
- 验证候选读取的数据库时间过滤、查询后到期/状态竞速及原订单库存释放行为。
- 验证卡片按钮只重新读取本人订单并打开确认弹框；用户取消弹框不发请求，确认后调用原 API。
- 修复集成冲突后由原所有者或主代理明确接管文件，避免并发覆盖。

退出条件：端到端自动化覆盖工具调用→可信卡片→用户确认→本人取消，且普通问单、他人订单和模型文本不能越权触发动作。

### 阶段 3：全量回归与 Smoke Test

- 运行 API 全量测试、订单和聊天相关隔离 PostgreSQL 套件、API/Web 类型检查及构建、`pnpm check`。
- 使用仅测试账号和隔离数据运行本地 HTTP Smoke Test；如果浏览器登录环境可用，再验证桌面和窄屏卡片操作。
- 复核 trace、展示 envelope、网络请求和应用日志无收件信息、物流凭据、Token 或完整工具结果副本。
- 不调用真实模型、支付或外部售后服务；不运行清库迁移命令。

退出条件：每条验收有实际结果记录；未执行或环境门控跳过的检查明确列为缺口。

## 验收矩阵

| 编号 | 验收项                                                      | 主要证据                                |
| ---- | ----------------------------------------------------------- | --------------------------------------- |
| V01  | 查询只读当前用户的未过期待付款订单，最多 5 笔且排序稳定     | 订单 Service 单测与隔离 PostgreSQL 测试 |
| V02  | `clock_timestamp()` 到期边界严格排除；读取不改变状态或库存  | 订单 PostgreSQL 边界测试                |
| V03  | 模型没有 userId 参数和订单写工具；工具输出无收件/物流信息   | 工具 schema、LLM 工具与 trace 单测      |
| V04  | 只有合法工具结果可生成订单卡；Markdown/未知字段不能生成动作 | display schema 和 SSE 测试              |
| V05  | 旧 envelope 可恢复；卡片字段和字节预算受限                  | display projection/历史兼容测试         |
| V06  | 卡片取消按钮先核实本人订单并打开确认弹框，不立即提交        | 前端 composable/操作检查及 Smoke Test   |
| V07  | 用户确认才调用原取消 API；成功后状态来自响应                | API/聊天集成测试                        |
| V08  | 过期、已支付、409、未知结果、账号切换及重复点击安全处理     | 服务端状态测试与前端异步行为检查        |
| V09  | trace、卡片、日志无收件人、手机号、地址或物流单号           | 专项隐私测试与实际响应检查              |
| V10  | 原本人订单取消、库存释放、购买卡、历史聊天兼容              | API 全量测试与 `pnpm check`             |

## 验证命令与数据库纪律

实现后至少执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm check
git diff --check
```

`pnpm check` 不替代 API 全量测试，也不代表数据库门控测试已通过。订单查询时间边界若需要真实 PostgreSQL，沿用仓库现有订单隔离测试开关与库名校验；运行前从测试源码确认库名安全检查及 teardown 行为，只连接具名 disposable 数据库。无 schema 变化，不运行 Migration，不执行 `migration:fresh`。

若全仓格式检查被未修改文件阻塞，只格式化本业务变更文件并记录原始失败；不回滚或格式化无关工作区改动。前端目前未安装 Vitest、Vue Test Utils 或 Playwright，不新增测试依赖或脚本；可用既有 typecheck/build 和允许的手工 Smoke Test，如无法执行则如实报告。

## 风险与停止条件

- 不能以数据库时间可靠筛除已到期订单时，停止可取消候选实现；不可用客户端时间或模型推断替代服务端资格。
- 订单候选工具输出需要新增收件、物流或管理字段时，停止并先更新隐私契约。
- 若取消按钮不能复用本人取消端点及现有确认弹框，或需要新增 API/持久化结构/迁移，返回设计与 CRUD 契约阶段重新审批。
- 如果公开历史消息无法将结构化卡片可靠绑定到 assistant 消息，停止历史可操作卡片实现；不能从历史 Markdown 重建可执行按钮。
- 账号/会话切换、重复提交、结果未知或订单状态竞争可造成跨账号污染或误报成功时，停止交付，先补保护与测试。
- 真实退款、已付款取消、额外售后功能、运行时依赖、生产操作均不在范围；任何此类要求须单独审批。

## 子代理完成报告

每个子代理交付时提供：

```text
修改文件：
公开类型/接口：
执行命令：
测试结果（通过/失败/跳过/未执行）：
未解决风险：
越界修改（没有则写无）：
```

主代理最终实施记录需区分自动化通过、隔离数据库通过、Smoke Test 通过、跳过和未执行；不把文档审批或构建成功描述成已实现或已验证。

## 实际交付记录

- 订单模块增加当前用户未过期 `pending_payment` 候选读取，使用数据库时钟、稳定倒序和最多 5 笔限制；原取消事务与本人 API 未改变。
- `list_my_orders` 的待付款筛选只返回卡片所需白名单；普通查询保持原结构。聊天只从成功且严格校验的候选工具结果生成结构化 SSE 和 `publicDisplay` 历史字段。
- 聊天卡片复用订单详情读取和现有取消确认弹框；用户确认后调用原取消 API，成功状态来自服务端响应。已付款订单、退款及其他售后仍不支持。
- 工具候选最多包含 50 条安全商品明细；公开订单卡片为控制展示快照预算仅呈现前 5 条商品规格。
- 未新增公开 HTTP API、数据库结构、Migration、依赖或前端测试框架。

### 验证结果

| 检查                                   | 结果                                                     |
| -------------------------------------- | -------------------------------------------------------- |
| 订单、聊天投影、trace 与聊天流定向测试 | 50/50 通过                                               |
| API 全量测试                           | 265 通过；15 项 PostgreSQL/迁移门控测试跳过；0 失败      |
| API 类型检查与构建                     | 通过                                                     |
| Web 类型检查与构建                     | 通过                                                     |
| `pnpm check`                           | 通过，包含格式、全仓类型检查和构建                       |
| `git diff --check`                     | 通过                                                     |
| 隔离 PostgreSQL 订单边界测试           | 未执行；没有确认具名 disposable 数据库，不连接默认开发库 |
| 登录态浏览器 Smoke Test                | 未执行；Web/API 可访问性已检查，但未进行真实账户交互     |

当前 `http://localhost:5173` 和 `http://localhost:3000` 已有本地服务监听。Web 使用 Vite 开发服务器可读取最新前端源码；API 进程显示为 `node dist/main`，需要重启 API 服务后才会加载本次后端代码。未停止或覆盖现有进程。
