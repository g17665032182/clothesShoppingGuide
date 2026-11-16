# 对话工具第二阶段实施文档

## 状态与前置确认

- 状态：2026-11-16 用户回复“确认”批准实施文档；第二阶段已实现并完成自动化及隔离数据库验收，登录态浏览器未执行。全仓格式检查有一处既有文档阻塞，详见执行记录。
- 日期：2026-11-16。
- 已确认：[第二阶段设计](./chat-tool-phase-two-design.md)、[扩展增量契约](../contracts/chat-tool-expansion-crud-contract.md)，用户回复“可以”；随后分别回复“确认”批准[第二阶段技术方案](./chat-tool-phase-two-technical.md)及本文。
- 关联契约：[商品目录](../contracts/product-catalog-crud-contract.md)、[用户偏好](../contracts/user-preferences-crud-contract.md)、[长期记忆](../contracts/user-memory-crud-contract.md)。
- 工作方式：沿用用户要求的 agent team，独占文件并行开发，主代理审阅集成与最终验证。
- 验证依据：[环境与验证约定](../development/validation.md)、[项目全量验证计划](../testing/project-full-validation-plan.md)。

本文保留已确认方案的分工与执行规则，实际验证记录见文末，不把首期结果或文档检查视为第二阶段实现证据。

## 交付范围

- 新增 get_product_skus：商品外部标识、可选颜色/尺码精确筛选，先完整过滤再计数和分页，固定每页 5 条、页码 1–10；只返回安全规格、CNY 价格字符串和扣除有效预占后的有货布尔值。
- 新增 get_my_preferences：本人有效且未删除记录，可选九类之一，主偏好优先及稳定分页；只返回安全值和类别等白名单字段。偏好关闭返回 preferences_disabled，缺设置按默认 true 解释但不创建设置。
- 两类 reader 使用独立短只读 REPEATABLE READ 快照，SKU 原生 SQL 显式传递事务上下文。
- JSON/SSE 共用工具链。经校验调用任一新工具后，无论成功、空页、disabled、not_found 或 unavailable，两条消息同事务退出自动记忆/摘要来源，不登记记忆任务，下一普通轮恢复。
- trace 仅保存合法筛选标记、枚举、页码、计数和固定错误；activity 输入输出为 null；历史成对隐藏工具调用/结果，最终聊天正文按原规则保存。
- 同步服务端实际加载的提示词、能力清单、契约、README 和实际验证记录。

不交付偏好写入、开关修改、规格自动选择、购买授权、物流、售后或新展示界面。不新增依赖、HTTP 路由、SSE 事件、卡片、页面、Entity、字段、索引、迁移或环境配置。不调用真实 LLM、图像/存储供应商，不上传真实照片，不部署、提交或推送代码。

## 启动前检查与接口冻结

本文获确认后，主代理先执行：

1. 检查 git status 与相关文件差异，保留已有文档、配置和用户变更；不回滚、批量格式化或顺带修复无关文件。
2. 各代理完整阅读 AGENTS、设计、技术、关联契约及相应 backend/security/validation 文档。核对本地安装版本、已有实现及技术文档列出的官方依据；未发生版本变化时复用已核对结论，不引入替代框架。
3. 冻结下表的公共接口、工具名和错误码，确认代理只能写其独占文件。共享源码文件与根配置由主代理维护。
4. 核对新集成套件的开关、库名注入和清理逻辑；数据库未确认归属前不创建、迁移或执行测试，不使用默认库兜底。

| 接口或规则                                             | 提供者 | 固定约定                                                                                    |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| productSkuLookupSchema                                 | A      | strict 输入，导出 z.input 的 ProductSkuLookupSchemaInput、z.output 的 ProductSkuLookupInput |
| productSkuLookupResultSchema / ProductSkuLookupResult  | A      | 严格成功分页或固定 not_found/unavailable，无原始行                                          |
| ProductSkuReaderService.listForChat(query)             | A      | 独立快照，数据库全量条件过滤，返回上述结果                                                  |
| preferenceChatQuerySchema                              | B      | strict 输入，导出 z.input 的 PreferenceChatQueryInput、z.output 的 PreferenceChatQuery      |
| preferenceChatResultSchema / PreferenceChatResult      | B      | 严格成功分页或固定 preferences_disabled/unavailable                                         |
| UserPreferencesReader.listForChat(userId, query)       | B      | 复用现有公开 Port；保留 readContext 行为及模块 useExisting                                  |
| createChatProductSkusTool(reader, onRequested)         | C      | 使用 A 的公开 schema/reader，在第一次 await 前回调，不接收模型身份                          |
| createChatPreferencesTool(reader, userId, onRequested) | C      | userId 为服务端独立参数，其他规则同上                                                       |
| PreparedChat.detailQueryRequested                      | 主代理 | 每轮初始 false，任一新工具经校验调用置 true；保留首期标记与原购买条件                       |

DTO 名称只固定第二阶段新增入口，不重命名旧资源。输入 schema 同时供工具和领域使用；page 解析后必填，结果 pageSize 固定 5，hasNext 与真实 total 一致。字符串控制字符须在 trim 前检查，不能用 trim 掩盖非法字符。

A/B 先发布 schema、类型和可工作的领域实现，C 再接入真实公开能力。C 可在自有工具测试中使用满足接口的替身，但不得在生产代码增加假成功或可选占位。跨模块不得深层导入 Entity、Repository 或私有值校验实现。

## Agent Team 文件所有权

实施已获确认，按 A、B、C 三个子代理及主代理执行。三个子代理在独立文件上并行，共享资源由主代理串行验证。

### A：商品规格领域

独占文件：

- 新增 `apps/api/src/product-catalog/dto/product-sku-lookup.dto.ts`。
- 新增 `apps/api/src/product-catalog/service/product-sku-reader.service.ts`。
- 新增 `apps/api/src/product-catalog/spec/product-sku-lookup.schema.spec.ts`、`product-sku-reader.service.spec.ts`。
- 修改 `apps/api/src/product-catalog/index.ts`、`product-catalog.module.ts`。

任务：严格输入/结果 schema、独立 reader 与 Nest 公开导出；完整条件 count 和分页使用相同快照，所有原生 execute 显式传事务上下文；复用既有 lower 精确比较、排序与预占视图。

验收：非法输入不查询；超过默认页和累计 100 条仍能正确筛选；同色同码不同价不合并；空页总数、not_found/无匹配/无货/unavailable 区分；输出不含 SKU ID、图片或库存数量。

禁止修改原 ProductCatalogService、购买/订单库存协作、Entity、导入、迁移及其他代理文件。数据库真实快照与预占事实由主代理集成套件验证，不以单元替身代替。

### B：本人偏好领域

独占文件：

- 新增 `apps/api/src/user-preferences/dto/preference-chat-query.dto.ts`。
- 新增 `apps/api/src/user-preferences/spec/preference-chat-query.schema.spec.ts`、`user-preference-reader.service.spec.ts`。
- 修改 `apps/api/src/user-preferences/service/user-preference-reader.service.ts`。
- 修改 `apps/api/src/user-preferences/port/user-preferences.port.ts`、`index.ts`。

任务：扩展既有 reader/Port，独立实现完整明细分页，不调用相关性摘要或管理列表。独立快照中先直接查设置，关闭不读值，缺行不创建；按本人、active、deletedAt null、category 过滤并稳定排序。

值校验复用领域现有类别 schema 和敏感扫描，valueType 与类别不符、当前页损坏或不安全时整次 unavailable，不以重新派生或静默丢条掩盖问题。不修改 readContext 的推荐行为、CRUD、设置写服务或旧任务。

验收：九类和值/类型关系、本人隔离、双删除条件、主偏好/同时间排序、分页真实总数、缺设置和关闭不写入。模块接线沿用现有 useExisting，无需改 user-preferences.module。

### C：工具、安全追踪与历史

独占文件：

- 新增 `apps/api/src/chat-records/tools/chat-product-skus.tool.ts`、`chat-preferences.tool.ts`。
- 新增 `apps/api/src/chat-records/spec/chat-product-skus.tool.spec.ts`、`chat-preferences.tool.spec.ts`。
- 修改 `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`、`history/chat-history.mapper.ts`。
- 修改 `apps/api/src/chat-records/spec/chat-trace-writer.service.spec.ts`、`chat-history.mapper.spec.ts`。

任务：工厂使用 A/B 公开入口，schema 校验后、第一次 await 前触发回调；安全二次投影/校验后序列化，错误固定不含原文。扩充 trace 白名单及历史隐藏集合，不修改供模型读取的安全结果。

验收：成功/空/disabled/not_found/unavailable 均回调；独立事件、model_response 嵌套 toolCalls/tool_calls/invalid_tool_calls、JSON 字符串 args 与结果 content/payload 均无商品标识、筛选文本、偏好值、图片和内部 ID；未知参数和解析错误不得回退原值；工具调用/结果成对隐藏。

禁止修改 ChatRecordsService、消息 Entity、运行图全局错误策略、display/activity 结构或数据库接线。与真实 JSON/SSE 的联调由主代理完成。

### 主代理：共享接线、来源资格和最终验收

独占文件：

- `apps/api/src/chat-records/service/chat-records.service.ts`，必要时 `chat-records.module.ts`。
- `apps/api/src/chat-records/spec/chat-records.service.spec.ts`、`chat-try-on-information.postgres.spec.ts`、`chat-stream.postgres.spec.ts`、`personalization.postgres.spec.ts`。
- `apps/api/src/chat-purchase/spec/purchase.postgres.spec.ts`。
- `apps/api/src/chat-records/spec/chat-context.service.spec.ts`、`chat-extraction-source.service.spec.ts`。
- 新增 `apps/api/src/chat-records/spec/chat-tool-phase-two.postgres.spec.ts`。
- `apps/api/src/llm/context/system-context.md`、必要的 `shopping-flow.md` 及 `llm/spec/system-context.spec.ts`。
- 本阶段设计、技术、实施与契约状态，以及能力清单、README、全量验证计划。

任务：注入 SKU reader、装配工具及每轮回调；资格判定追加 detailQueryRequested，不覆盖首期和购买条件。适配直接构造 Service 和扩展 Port 的所有现有测试替身，包括门控关闭但仍参与类型检查的文件。

主代理负责真实 reader + 实际 ToolNode + JWT + fake 模型 + PostgreSQL 的 JSON/SSE 集成、追踪/历史/记忆/摘要断言及清理。默认复用既有 source reader 和摘要规则，不顺带改造提取系统；若测试证明需要源码修复，先明确证据和必要范围，再由主代理接管并补回归。

根配置、锁文件、应用根模块、数据库/迁移和构建资源不交由子代理并发修改。本轮没有预期依赖或根配置变更。任何所有权调整须先停止原负责人的写入并明确移交；不得因类型报错擅自修改他人文件。

## 执行阶段与退出条件

| 阶段            | 执行内容                                                          | 退出条件                                         |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| 0：确认与基线   | 本文确认，冻结接口和文件分工，复查现有差异与验证环境              | 没有未决业务权限，公共接口和资源归属明确         |
| 1：领域实现     | A/B 并行完成 schema、reader、公开导出和领域单测                   | 严格输入输出、只读快照、错误语义可用             |
| 2：工具与接线   | C 完成工具/trace/history；主代理接入 DI、回调、资格和提示词       | 实际领域能力接入，JSON/SSE 同一来源规则          |
| 3：静态和回归   | 主代理审阅差异，适配旧夹具，运行定向及 API 全量、格式、类型、构建 | 无越界写入、无私有导入、无资格/旧流程回归        |
| 4：真实链路     | 具名隔离 PostgreSQL，JWT + 工具图 + fake 模型，串行运行           | 快照、可售、无写入、追踪/历史/来源规则有实际证据 |
| 5：浏览器与交付 | 受控配置下人工桌面/窄屏；文档记录真实结果与清理                   | 已执行/失败/跳过/未执行分开，缺口不冒充通过      |

代理的局部单元测试可在不共享资源时并行。主代理独占数据库、端口及最终构建；不让子代理各自运行全仓构建、全量测试、迁移或启动服务。接口调整由主代理同步所有依赖方后再继续。

## 验收矩阵

下表是批准的验收矩阵，执行结果在交付记录中逐项登记。自动化、数据库、浏览器及真实供应商是不同证据层次。

| 编号 | 验收要求                                                              | 证据与负责人                                   | 当前状态        |
| ---- | --------------------------------------------------------------------- | ---------------------------------------------- | --------------- |
| V01  | 严格输入、默认页码、数值类型、控制字符、九类与未知字段拒绝            | A/B schema、C 工具测试；非法输入无查询         | 通过            |
| V02  | SKU 完整过滤后分页，累计超 100 条、稳定排序、空页 total/hasNext       | 单测；真实125条有效规格，目标位于第118条之后   | 通过            |
| V03  | 商品不可用/无匹配/无货分开，预占后可售、同色同码不合并                | 单测与真实订单预占视图 fixture                 | 通过            |
| V04  | 偏好本人/删除/类别过滤、九类安全值、类型匹配和稳定排序                | 单测与真实 PostgreSQL                          | 通过            |
| V05  | 设置缺行 true 不补建，关闭不读取值；不触发写入或旧任务                | SQL 记录、完整领域快照前后比较及设置计数       | 通过            |
| V06  | 两类查询真实 read-only/RR；SKU SQL 同一事务；并发修改不混合快照       | 实际事务设置、同一非空 ctx 及另一连接并发提交  | 通过（PG16.14） |
| V07  | 二次白名单、故障/坏值固定错误，无内部 ID/图片/精确库存                | 单测与实际 ToolMessage                         | 通过            |
| V08  | trace 独立/嵌套/非法调用与结果副本安全；activity null；历史配对隐藏   | 单测及真实 JSON/SSE 持久化                     | 通过            |
| V09  | 成功/空/失败/disabled/not_found 整轮资格 false、无入队，下一轮恢复    | 两传输各9种结果、并行两工具及同会话普通轮      | 通过            |
| V10  | 混合批次/候选重试/摘要不能读回排除来源，消息 ID 与 trace 正确绑定     | 实际 source/summary 检查与既有 Worker 回归     | 通过            |
| V11  | JWT 401、未知 Body 400、会话越权 404、实际 ToolNode 往返、提交后 done | 真实 HTTP/PG + fake 模型；读到 done 即查提交   | 通过            |
| V12  | 原推荐、购买、地址选择、动态表单、订单、试穿与首期查询兼容            | 全量单元及首期 PG 回归通过，其他15项旧门控未开 | 部分验证        |
| V13  | 桌面/窄屏查询、空/失败/重试、账号/会话切换、进入原管理页              | 无受控全站 fake 模型 harness                   | 未执行          |

无新迁移，不生成迁移快照；只验证现有迁移能初始化本轮专用库。真实模型/供应商不在本次自动化范围，不以 fake 模型通过宣称已验收真实服务。

## 隔离数据库与集成命令

新增测试套件必须自行检查：

- `RUN_CHAT_TOOL_PHASE_TWO_POSTGRES_TEST=1` 才执行；默认关闭时 skipped，不能算通过。
- `CHAT_TOOL_PHASE_TWO_TEST_DB` 非空，匹配 `^clothes_guide_chat_tool_phase_two_test_[a-z0-9_]+$`，且不同于配置默认库和 clothes_guide；缺失或不安全时拒绝执行。
- ORM 初始化显式注入 dbName，不只设置环境变量后假定已生效；查询、迁移和清理均使用同一 ORM 目标。
- 计划库名为 `clothes_guide_chat_tool_phase_two_test_20261116`。创建前查询确认不存在；若存在则不接管，换同前缀唯一后缀，并在记录和命令中使用实际名称。
- 主代理在检查归属后创建库，套件只应用既有增量迁移并准备本轮 UUID fixture，不自行删建库；缺库不能回退默认库。

拟运行命令，须在实施后审阅实际源码并创建专用库才可执行：

```bash
RUN_CHAT_TOOL_PHASE_TWO_POSTGRES_TEST=1 \
CHAT_TOOL_PHASE_TWO_TEST_DB=clothes_guide_chat_tool_phase_two_test_20261116 \
pnpm --filter @clothes-shopping-guide/api exec tsx --test --test-concurrency=1 \
src/chat-records/spec/chat-tool-phase-two.postgres.spec.ts
```

fixture 使用合成 owner/stranger、会话、商品、有效/停用/无货/预占规格、九类偏好、关闭/缺失设置与损坏值。库存事实使用现有迁移的真实预占视图及其底层合法约束，不替换视图或放宽生产约束。快照用例用独立连接提交受控并发修改，断言新调用读到新状态、同次查询不混合旧新结果。

复用首期 HTTP/fake 模型的测试接线模式，不复制全应用启动，不注册 Worker、调度器、存储或真实模型 provider；只安装所需 reader/服务/Guard。HTTP 绑定本机动态空闲端口，多轮按请求边界使用 EM，最终模型响应绑定真实有效 trace。

测试在 finally 中关闭应用、HTTP、ORM/EM 资源，只按本轮 UUID/明确外部标识删除 fixture；无迁移成功时不清理不存在的表。执行者记录数据库创建来源，确认连接关闭后仅删除自己新建的专用库，并查询确认库已不存在。失败时保留安全诊断信息，不扩大清理到默认或用户原有库，不输出密码、Token、SQL 参数原文或图片。

## 自动化与浏览器流程

局部测试按各代理拥有的 spec 执行并汇报，主代理集成后串行执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
git diff --check
```

API 默认测试的门控 skips 与另行开启的数据库结果分别记录，不重复计算通过数。pnpm check 不含 API test。若全仓格式受未改文件阻塞，保留原文件、记录失败，完成变更文件定向格式与独立类型/构建检查；本轮没有新变更或未决问题时不重复跑已通过的相同检查。

浏览器仅在确认专用库、合成账号、可用端口和受控 fake 模型后启动必要服务，记录实际 URL；不覆盖用户既有进程。桌面/窄屏检查两工具回答、空页、关闭偏好、失败重试、切账号/会话和进入原购买/偏好管理界面。无安全可用的全站 harness 时将 V13 记为未执行并说明原因，不改用真实供应商，也不为了验收新增产品配置或前端功能。

本阶段不安装浏览器测试框架。没有前端变化仍须区分构建和登录态交互验收；首期遗留浏览器缺口继续保留，不被本阶段自动清零。

## 文档同步与交付记录

代码实际接入后由主代理同步：

- 本阶段 design、technical、本实施文档，以及总扩展设计和增量契约的真实状态。
- 商品目录、用户偏好、长期记忆契约：批准语义与实现、验证证据分别说明。
- 能力清单：仅在实际注册后把两个工具从候选移动到已接入。
- README：实际工具边界、偏好开关、来源隔离及相关文档入口。
- 全量验证计划：实际新增测试文件、开关、库名约束及实际结果入口。
- system-context.md 和必要的购物流程，确保运行时读取到更新内容。

每位子代理报告：

```text
修改文件：
执行命令：
测试结果（通过/失败/跳过/未执行）：
公开接口及接线要求：
未解决风险：
越界修改（没有则写无）：
```

主代理交付记录包含实际代码范围、分工、命令及测试数量、已执行 HTTP/数据库/浏览器覆盖、专用库名与创建/清理证据、失败或未执行原因和当前 Git 状态。

### 执行记录（2026-11-16）

- 用户已确认本文，A/B/C 按独占文件完成领域及工具实现；主代理完成两工具注册、每轮资格、构造夹具和服务端实际提示词接线。未新增依赖、HTTP 路由、数据结构、迁移或写权限。
- 所有权调整：A 交付商品领域六文件并停止写入后，主代理将新增 `chat-tool-phase-two.postgres.spec.ts` 的独占编写权移交 A；主代理仍独占数据库创建、迁移测试执行、端口及清理。B 完成类型修复后对全部生产差异做只读交叉审阅；C 完成八文件并停止写入。
- 子代理定向结果：A 14 项、B 15 项、C 35 项全部通过；主代理聊天编排/提示词首轮 26 项通过。API 类型检查首次发现 B DTO 的联合 schema 方法签名冲突，修正后通过。各代理报告越界修改均为无；新增数据库测试最终已移交主代理并停止并行写入。
- API 全量首轮为 393 项，376 通过、1 失败、16 门控跳过；失败为主代理调整提示词后未同步的旧正则断言，已修正。最终全量为 **394 项，377 通过、0 失败、17 门控跳过**，其中本阶段和首期两个套件另行开启并通过，其他15项旧门控本轮未开启。
- 环境：默认 5432 PostgreSQL 未运行，Docker daemon 未运行；本机安装 PostgreSQL 16.14。主代理用 `initdb` 在 `/tmp/clothes-guide-phase-two-pg-1q9atx/data` 新建本轮专属 cluster，仅监听 `127.0.0.1:55436`，未启动默认开发库。`pg_database` 查询确认计划库不存在后，创建 `clothes_guide_chat_tool_phase_two_test_20261116`；测试进程显式覆盖连接变量，不写环境文件。PostgreSQL 17 的版本一致性仍需单列说明。
- 第二阶段真实 PostgreSQL 最终源码复测 **11 项通过、0 失败、0 跳过**（父测试加10个子测试）。两传输各9种结果、并行工具、换账号和同会话后续普通轮均通过；真实读到 done 后立即从另一 EM 查到已提交的两条不可提取消息。
- 首期试穿查询数据库回归 **7 项通过、0 失败、0 跳过**。在同一临时 cluster 中，先查询确认不存在后新建独立库 `clothes_guide_chat_try_on_information_test_phase2_20261116`，与第二阶段测试串行运行。
- `pnpm --filter @clothes-shopping-guide/api typecheck`、API `build`、仓库 `pnpm typecheck`、`pnpm build` 均通过，涵盖 API/Web/Shared。全仓 `pnpm format:check` 及 `pnpm check` 被本轮未修改的 `docs/chat-purchase/chat-purchase-prd.md` 格式问题阻塞，未改动该文件；全部变更 Markdown/TypeScript 定向格式检查及 `git diff --check` 通过。
- 清理：最终测试后查询确认本阶段 fixture 的 users/products/orders/preferences/messages/traces/memory_tasks 均为0，两个专用库均无活动连接；逐一 drop 本轮新建的两个库，再查 `pg_database` 确认两库及默认 `clothes_guide` 均不存在。临时 cluster 已停止，端口释放，临时数据目录已移入系统废纸篓；未启动、迁移或写入默认开发库，未改动环境文件。
- 未执行：V13 登录态桌面/窄屏没有受控全站 fake 模型 harness，未用真实供应商补验收；真实 LLM/图像供应商和 PostgreSQL17 版本一致性本轮未验证。其余旧数据库门控仍保留缺口，单测/构建通过不替代这些证据。
- Git 状态：本阶段代码、测试和文档保留为未提交修改；包含原先已批准但未提交的设计/契约文件。未提交、推送或部署，未修改根配置、锁文件、私有图片和环境文件。

最终命令（连接参数仅作用于测试进程，端口55436为本轮专属临时实例）：

```bash
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api build
pnpm typecheck
pnpm build
pnpm format:check
pnpm check
git diff --check

DB_HOST=127.0.0.1 DB_PORT=55436 DB_USER=phase_two_test DB_PASSWORD='' \
RUN_CHAT_TOOL_PHASE_TWO_POSTGRES_TEST=1 \
CHAT_TOOL_PHASE_TWO_TEST_DB=clothes_guide_chat_tool_phase_two_test_20261116 \
pnpm --filter @clothes-shopping-guide/api exec tsx --test --test-concurrency=1 \
src/chat-records/spec/chat-tool-phase-two.postgres.spec.ts

DB_HOST=127.0.0.1 DB_PORT=55436 DB_USER=phase_two_test DB_PASSWORD='' \
RUN_CHAT_TRY_ON_INFORMATION_POSTGRES_TEST=1 \
CHAT_TRY_ON_INFORMATION_TEST_DB=clothes_guide_chat_try_on_information_test_phase2_20261116 \
pnpm --filter @clothes-shopping-guide/api exec tsx --test --test-concurrency=1 \
src/chat-records/spec/chat-try-on-information.postgres.spec.ts
```

## 风险与停止条件

- 需要新增 API、依赖、数据结构、写权限或放宽开关时，停止扩展，回到受影响设计审批。
- raw SQL 缺事务上下文、总数/页数据混合快照、过滤前截断或精确库存泄漏时，先修复并补实际验证。
- 关闭偏好仍读取值、缺行产生写入、坏值被跳过或 valueType 被静默覆盖时，不交付该工具。
- 只标记 SSE、回调晚于 await、失败未标记、消息资格不同事务或后续来源可重新读入时，不交付来源隔离。
- trace 任一路径落入原文序列化、activity 输出业务值或历史调用结果不成对时，修复后再验收。
- 测试目标、资源归属或清理范围不明时，暂停该验证并报告，不扩大授权或切换默认库。
- 用户并行改动影响相同文件时先合并协作；只有无法安全继续才询问，不覆盖或撤销他人工作。

## 审批记录

2026-11-16 用户回复“确认”批准本文，设计、权限、数据及技术规则均已确认，无新增待确认业务决策。实施和验证在已批准范围内继续，不重复请求确认。

agent team 已按以上独占文件开展第二阶段实施，主代理负责集成、验证和真实交付记录；不重新打开已批准的开关、分页、来源隔离或无迁移范围。
