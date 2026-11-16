# 项目全量验证计划

## 状态与范围

- 状态：验证计划及分日期执行记录；各模块实际覆盖和未执行项以对应记录为准。
- 更新日期：2026-11-16。
- 范围：认证与用户管理、商品目录、LLM 与聊天、用户偏好和长期记忆、地址簿、订单与聊天购买/取消、管理员运营、虚拟试穿，以及仓库构建和运行时 Smoke Test。
- 历史记录：[Docker 实机全量测试记录](./docker-full-test-report.md)是 2026-10-28 的历史结果，不代表本计划已执行，也不覆盖之后新增的业务模块。
- 业务规则和验收字段以各模块当前 CRUD 契约及实施文档为准。设计稿或计划中的能力不因列入本计划而视为已实现。

本计划把“并行”限定为没有共享可变资源、不会互相覆盖结果的验证任务。所有数据库及迁移测试默认串行，即使当前配置看起来使用不同库，也不通过并发执行来节省时间。

## 并行与串行总览

| 阶段         | 验证任务                                    | 执行关系                | 原因                                                                                                                            |
| ------------ | ------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 准备         | 核查文档状态、测试门控、环境与目标库        | 可并行只读检查          | 只读且互不修改状态                                                                                                              |
| 快速自动化   | API 全量自动化测试；Web 类型检查            | 可并行                  | API 测试默认不启用门控 PostgreSQL 测试；Web 类型检查不连接 API/数据库                                                           |
| 质量门禁     | `pnpm check`、格式检查、构建                | 串行执行                | `pnpm check` 已包含格式、类型检查和构建；避免重复竞争构建输出                                                                   |
| 数据库验证   | 所有 PostgreSQL、迁移及真实数据库 HTTP 测试 | 必须串行                | 可能创建/迁移/清理数据库；环境门控和数据库选择易配置冲突，部分套件共享 `ORDERS_TEST_DB`、`PERSONALIZATION_TEST_DB` 或 `DB_NAME` |
| 本地运行     | API/Web 启动、健康检查和认证浏览器流程      | 串行执行                | 共享端口、API 进程、登录会话及测试数据                                                                                          |
| 外部服务验证 | 开发模型或虚拟试穿供应商 Smoke Test         | 与自动化/浏览器流程分开 | 依赖外部服务、密钥和供应商状态；失败原因及数据处理风险须单独记录                                                                |

数据库测试只有在确认每个套件的初始化、清理逻辑和完整目标库名后，才可考虑使用不同隔离库并行；本轮默认不采用此优化。不得让可能清理同一数据库的测试同时运行。

## 阶段 0：准备与安全检查

1. 阅读本计划涉及模块的最新实施记录、CRUD 契约和测试脚本，确认代码状态及测试入口没有变化。
2. 记录当前 Git 工作区状态；保留已有修改，不用测试流程覆盖或清理用户文件。
3. 检查 Docker/PostgreSQL 可用性、服务端口占用和必要环境配置。报告中不得显示 `.env`、密钥、访问令牌或数据库密码。
4. 为每个 PostgreSQL 测试准备明确命名、可销毁且不等于默认开发库的隔离数据库；逐项确认库名格式、测试实际消费的变量、是否追加 `_migration`、是否会 drop/重建，以及测试结束后的清理范围。
5. 无法确认数据库目标、默认库隔离或清理范围时停止数据库测试，不改用 `migration:fresh` 试探。

阶段 0 的只读检查可以并行；数据库创建、迁移及清理不得并行。

## 阶段 1：无数据库自动化与代码质量

### 可并行任务

- API 全量自动化测试：

  ```bash
  pnpm --filter @clothes-shopping-guide/api test
  ```

  默认运行时，未显式设置门控的 PostgreSQL 用例会被跳过。须分别记录 passed、failed 和 skipped；跳过不计为通过。

- Web 类型检查：

  ```bash
  pnpm --filter @clothes-shopping-guide/web typecheck
  ```

API 测试与 Web 类型检查不共享数据库、构建目录或应用端口，可以并行。

### 串行质量门禁

以上并行任务完成后运行：

```bash
pnpm check
pnpm --filter @clothes-shopping-guide/api test
git diff --check
```

`pnpm check` 已包含仓库格式检查、递归类型检查和构建；API 全量测试不包含在 `pnpm check` 中，必须单独执行。若第一阶段 API 测试没有代码变更且结果可复用，可在实际执行时避免重复运行，但最终报告仍应给出命令和结果。

当前仓库没有配置独立 Web 单元/组件测试脚本或 Playwright 依赖；不能把 Web 类型检查和构建描述为前端交互测试。

## 阶段 2：数据库和迁移测试

本阶段所有项目逐项串行执行。每一项开始前打印并复核**不含凭据**的目标数据库名；通过后确认连接已关闭，并按测试实现要求检查清理结果，再开始下一项。

### 2.1 订单、商品库存与管理员

- `RUN_ORDERS_POSTGRES_TEST=1` + `ORDERS_TEST_DB`：
  - `apps/api/src/orders/spec/orders.postgres.spec.ts`
  - `apps/api/src/product-catalog/spec/product-catalog-order.postgres.spec.ts`
  - `apps/api/src/order-catalog-coordination/spec/order-catalog-import.postgres.spec.ts`
- `RUN_ADMIN_PRODUCTS_POSTGRES_TEST=1` + `ADMIN_PRODUCTS_TEST_DB`：
  - `apps/api/src/product-catalog/spec/admin-product-catalog.postgres.spec.ts`
- 若管理员测试与商品试穿配置共享管理员业务库，按实施文档选择隔离库并串行复用；不得与其他正在运行的套件共用。

覆盖订单状态流转、库存预占/扣减/释放、并发与幂等、商品导入协作、管理员查询及发货约束。

### 2.2 聊天购买与迁移

- `RUN_CHAT_PURCHASE_POSTGRES_TEST=1` + `CHAT_PURCHASE_TEST_DB`：
  - `apps/api/src/chat-purchase/spec/purchase.postgres.spec.ts`
  - `apps/api/src/chat-purchase/spec/purchase-import.postgres.spec.ts`
- 使用全新、空的专用库运行 `apps/api/src/database/spec/chat-purchase-migration.postgres.spec.ts`。测试会以 `CHAT_PURCHASE_TEST_DB` 派生迁移库名；执行前核对完整目标名和清理逻辑。

覆盖草稿生命周期、价格/库存一致性、版本与幂等、并发、下单创建、会话删除兼容及增量迁移数据保留。

### 2.3 地址簿与偏好/长期记忆

- `RUN_USER_ADDRESSES_POSTGRES_TEST=1` + `USER_ADDRESSES_TEST_DB`：
  - `apps/api/src/database/spec/user-addresses-migration.postgres.spec.ts`
- `RUN_PERSONALIZATION_POSTGRES_TEST=1` + `PERSONALIZATION_TEST_DB`：
  - `apps/api/src/user-preferences/spec/preference-tasks.postgres.spec.ts`
  - `apps/api/src/user-memory/spec/user-memory-task.postgres.spec.ts`
  - `apps/api/src/chat-records/spec/personalization.postgres.spec.ts`
- `RUN_SEPARATION_MIGRATION_TEST=1` + 单独的 `PERSONALIZATION_TEST_DB`：
  - `apps/api/src/database/spec/preference-separation-migration.postgres.spec.ts`

迁移测试使用独立空库，不能和偏好/记忆业务测试同时使用同一个库。覆盖地址迁移、偏好/记忆任务幂等和租约、历史数据兼容、拆分迁移升级/回滚规则。

### 2.4 聊天展示/流式数据库 Smoke

- `RUN_CHAT_DISPLAY_POSTGRES_SMOKE=1`，并按测试代码要求显式设置隔离的 `DB_NAME`：
  - `apps/api/src/chat-records/spec/chat-display.postgres.spec.ts`
  - `apps/api/src/chat-records/spec/chat-stream.postgres.spec.ts`

此组与任何使用 `DB_NAME` 的服务进程或数据库套件串行运行。覆盖持久化展示投影、历史兼容及流式消息落库边界。

### 2.5 商品试穿设置迁移

- `RUN_PRODUCT_TRY_ON_POSTGRES_TEST=1` + `PRODUCT_TRY_ON_TEST_DB`：
  - `apps/api/src/database/spec/product-try-on-setting-migration.postgres.spec.ts`
- 商品管理员集成若使用 `RUN_ADMIN_PRODUCTS_POSTGRES_TEST=1`，在 2.1 管理员测试项中验证；不与之并行。

覆盖新增字段的空值兼容、旧商品设置保留、商品和任务历史数据不丢失，以及新商品默认状态。

### 2.6 聊天试穿任务只读查询

- `RUN_CHAT_TRY_ON_INFORMATION_POSTGRES_TEST=1` + `CHAT_TRY_ON_INFORMATION_TEST_DB`：
  - `apps/api/src/chat-records/spec/chat-try-on-information.postgres.spec.ts`
- 库名必须匹配 `clothes_guide_chat_try_on_information_test_*`，且不同于默认库。由调用方先核实并创建全新可销毁库，测试显式注入 ORM `dbName`，仅应用既有增量迁移。
- 测试只清理本次 UUID fixture 并关闭应用/ORM，不接管或删除已有库；执行者负责记录新建库来源和最终清理。与所有数据库、迁移和端口任务串行。

覆盖真实只读 REPEATABLE READ 快照、当页批量结果读取、本人/删除/状态分页、JWT + 实际 ToolNode + fake 模型的 JSON/SSE 往返、trace/activity/历史边界、整轮记忆及摘要排除和同会话普通轮恢复。测试不注册 Worker、存储或真实供应商；不代替浏览器和真实模型验收。实际结果见[实施记录](../modules/llm/chat-tool-expansion-implementation.md)。

### 2.7 精确规格与本人偏好明细

- `RUN_CHAT_TOOL_PHASE_TWO_POSTGRES_TEST=1` + `CHAT_TOOL_PHASE_TWO_TEST_DB`：
  - `apps/api/src/chat-records/spec/chat-tool-phase-two.postgres.spec.ts`
- 库名必须匹配 `^clothes_guide_chat_tool_phase_two_test_[a-z0-9_]+$`，不同于默认库和 `clothes_guide`。调用方确认不存在后创建专用库，测试显式注入 `dbName`，只应用现有迁移，不创建迁移快照或接管已有库。
- 主代理独占数据库、端口及清理，测试只删除本轮 UUID fixture 并关闭应用和 ORM；执行后核对专用库不存在。与其他 PostgreSQL、迁移和运行时任务串行执行。

覆盖超过100条的完整 SKU 筛选/计数/排序、真实预占视图、同色同码不合并；本人偏好九类/双删除过滤、关闭不读取值及缺设置不补建、坏值失败；两个 reader 的实际只读 RR 和并发快照、显式 raw 事务绑定；JWT + 实际 ToolNode + fake 模型的 JSON/SSE、安全 trace/activity/历史及整轮记忆/摘要排除。默认关闭门控的 skip 不计通过，真实数据库与浏览器、供应商分别记录。实际结果见[第二阶段实施记录](../modules/llm/chat-tool-phase-two-implementation.md)。

### 数据库测试退出条件

- 每项均记录命令、门控变量、隔离库名、测试数量、通过/失败/跳过数量及清理结果。
- 环境门控未启用、无数据库、目标库校验失败或测试 skipped 时，该项标为“未执行/未验证”，不得记为通过。
- 迁移失败时停止后续迁移测试，保留失败日志和隔离库状态供诊断；不得扩大清理到其他数据库。

## 阶段 3：服务端与浏览器 Smoke

数据库验证结束后再启动 API/Web。运行前确认目标端口空闲；若被占用，先识别并按当前任务授权处理占用进程，不可误杀不相关服务。

按以下顺序完成一次测试账号路径：

1. 检查 `GET /api/health`、Swagger 和 Web 登录入口。
2. 注册/登录测试用户，验证当前用户资料、Refresh Token、退出及禁用账号后的鉴权行为。
3. 登录后浏览商品目录，完成商品卡片、分页/筛选及推荐展示检查。
4. 使用 Fake Model 或受控模型配置执行聊天工具往返，确认工具被调用、trace 有记录、结果回到模型，公开历史不泄露内部参数。
5. 检查本人地址簿及购买弹框：地址工具只返回引用；用户选择后服务端填入草稿；新地址只有显式确认保存后才加入地址簿。
6. 从商品卡完成购买草稿、显式下单、模拟支付和本人订单查看；通过 Fake Model 请求打开当前草稿弹框，核实服务端重读与会话隔离；生成期间只编辑本地字段，保存及订单操作等待生成结束。取消仅验证未过期待支付订单，并通过订单卡选择和确认。
7. 使用管理员账号验证商品/订单查询和发货；再用普通账号确认收货。测试账号、订单和商品必须为合成数据。
8. 验证试穿商品资格、上传测试图、任务状态、结果归属与删除。使用批准的公开/合成图片，不上传真实用户照片。
9. 至少检查桌面和窄屏下关键弹框、键盘操作、加载/空/失败/重试、成功 Toast，以及身份/会话切换后的状态隔离。

以上依赖同一 API、登录会话和测试数据，必须串行。前端缺少自动化浏览器框架时，应如实将其记录为人工 Smoke，不称为自动化 E2E。

## 阶段 4：外部供应商检查

- LLM 真实供应商调用和试穿图像生成均为可选的开发环境 Smoke Test，不与自动化测试并行，也不作为安全、持久化或权限测试的证据。
- 使用独立开发凭据和公开/合成输入；先确认请求目的地和数据边界。供应商失败或凭据缺失只记录为外部依赖未验证。
- 不测试真实支付，不上传真实用户人像。没有供应商关于人像留存、处理地区、禁止训练和删除保障的书面依据时，生产真实人像流程保持关闭。

## 结果报告模板

按模块列出以下状态：

| 模块/阶段 | 状态（通过/失败/跳过/未执行） | 命令或路径 | 结果摘要 | 数据库/外部依赖 | 遗留问题 |
| --------- | ----------------------------- | ---------- | -------- | --------------- | -------- |

最终总结至少报告：

- API 自动化总数及通过、失败、跳过数。
- `pnpm check`、API/Web 构建和类型检查结果。
- 每个 PostgreSQL/Migration 测试的隔离库、门控、结果及清理情况。
- HTTP/浏览器 Smoke 实际走过的用户路径和桌面/移动覆盖。
- LLM/试穿供应商是否实际调用、使用何种非敏感测试素材，以及未验证的外部限制。
- 默认开发数据库未被清空或作为测试夹具写入的确认依据。
- 所有未执行项和测试失败；不得将跳过或源代码审查表述为通过。

## 第二阶段增量验证（2026-11-16）

本次只执行对话工具第二阶段及相邻回归，不重新声明所有历史模块已完成全量数据库或浏览器验收。完整命令、分工及验收矩阵见[第二阶段实施记录](../modules/llm/chat-tool-phase-two-implementation.md)。

| 项目                                          | 实际结果                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| API 全量默认门控                              | 400项：383通过、0失败、17跳过；两个跳过套件另行开启通过，其他15项旧数据库门控未开启                                            |
| 第二阶段真实 PostgreSQL/JWT/ToolNode/JSON/SSE | 11通过、0失败、0跳过                                                                                                           |
| 首期试穿任务查询 PostgreSQL 回归              | 7通过、0失败、0跳过                                                                                                            |
| API/Web/Shared 类型与构建                     | API独立typecheck/build及仓库pnpm typecheck/build通过                                                                           |
| 格式与仓库组合门禁                            | 已单独格式化既有 `docs/modules/chat-purchase/chat-purchase-prd.md`；`pnpm format:check` 与 `pnpm check` 通过                   |
| 数据库与清理                                  | 本轮临时PostgreSQL16.14，127.0.0.1:55436；两个新建专用库已删除并查不存在，进程停止，数据目录移入废纸篓，默认开发库未启用或写入 |
| 未执行                                        | 登录态桌面/窄屏、其他旧数据库门控、PostgreSQL17版本一致性及真实LLM/图像供应商                                                  |

数据库分别为 `clothes_guide_chat_tool_phase_two_test_20261116` 和 `clothes_guide_chat_try_on_information_test_phase2_20261116`，均在创建前查询确认不存在，测试和清理串行执行；没有修改环境文件或生成迁移快照。API 全量首次的旧提示词正则断言失败已修复，最终复测无失败；随后单独格式化既有购买 PRD，`pnpm format:check` 与 `pnpm check` 均通过。

## 执行记录（2026-11-11）

本次使用三个独立、临时 PostgreSQL 17 容器（55432、55433、55434），容器数据目录为 tmpfs；测试数据库均使用 `clothes_guide_*_test_*` 命名。数据库组由根代理和两个子代理按独立容器分工执行；在同一容器/共享数据库内的测试串行运行。结束时三个临时容器均已停止并删除。开发数据库容器仍只监听原端口 5432，本次未连接、迁移或写入该库。环境门控关闭的 PostgreSQL 测试按跳过统计，不计通过。

### 结果汇总

| 验证项                          | 状态               | 实际结果                                                                                                                  |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| API 全量自动化                  | 通过（含门控跳过） | 265 passed、0 failed、15 skipped；跳过项为关闭门控的 PostgreSQL/Migration 测试                                            |
| Web 类型检查                    | 通过               | `pnpm --filter @clothes-shopping-guide/web typecheck`                                                                     |
| 仓库质量门禁                    | 通过               | `pnpm check`；格式、递归类型检查及 API/Web/Shared 构建通过                                                                |
| 订单、库存与目录协作 PostgreSQL | 通过               | 7 passed、0 failed；临时库 `clothes_guide_orders_test_full20261111`                                                       |
| 管理员商品 PostgreSQL           | 通过               | 1 passed、0 failed；复用上述已迁移临时库                                                                                  |
| 聊天购买 PostgreSQL             | 通过               | 13 passed、0 failed；子代理使用独立临时容器及 `clothes_guide_chat_purchase_test_full20261111`                             |
| 地址簿 Migration                | 通过               | 1 passed、0 failed；子代理使用独立临时容器及 `clothes_guide_user_addresses_test_full20261111_migration`                   |
| 偏好与记忆 PostgreSQL           | 部分通过           | 2 passed、1 failed；偏好任务、记忆任务通过；聊天集成用例报“最终模型记录缺失，无法保存回复”                                |
| 偏好/记忆拆分 Migration         | 通过               | 1 passed、0 failed；临时库 `clothes_guide_separation_test_migration20261111`                                              |
| 聊天展示/流式 PostgreSQL        | 部分通过           | 展示测试 1 passed；HTTP 流测试失败，SSE 实际为 `start,error`，预期工具调用事件和 `done`                                   |
| 聊天购买 Migration              | 失败               | 向上迁移成功；回滚 `Migration20261109120000` 时 PostgreSQL `2BP01`，`try_on_photos_task_fk` 仍依赖待删除的 `try_on_tasks` |
| 商品试穿设置 Migration          | 失败               | 全量迁移应用 15 条后，测试断言期望 14 条，在后续历史数据/字段断言前失败                                                   |
| 本地运行探活                    | 通过               | `http://localhost:5173/` 返回 200；`GET /api/health` 返回 200；API/Web 均已停止                                           |
| 浏览器                          | 部分通过           | 浏览器确认公开首页正常渲染；没有已认证测试会话，未执行受保护页面和下单/管理员交互                                         |
| 外部 LLM/图像供应商             | 未执行             | 未调用真实供应商、未使用真实用户照片；安全及真实生成行为未验证                                                            |

### 失败与阻塞

1. 聊天购买迁移的 down 顺序需要处理照片表到任务表的反向外键依赖；当前回滚不能完成。
2. 偏好/记忆 PostgreSQL 集成用例和聊天 HTTP 流用例均在最终模型回复记录/流事件阶段失败。当前证据不足以确认是否为同一根因，需单独定位后重跑。
3. 商品试穿设置迁移测试中的迁移数量期望与当前迁移集合不一致；需确认基线是否应更新，再重跑完整数据保留断言。
4. 当前未取得已认证浏览器会话，完整登录后业务流程仍未覆盖。前端没有项目内 Playwright/Vitest 测试脚本，浏览器检查为人工 Smoke。

### 未执行或未验证

- 试穿设置迁移在数量断言处中止，未验证后续历史数据、字段默认值和回滚断言。
- 聊天购买迁移在回滚错误后按要求停止后续断言。
- 偏好/记忆数据库组因集成用例失败而停止；其拆分 Migration 后续在另一空隔离库单独通过。
- 外部真实模型和图像生成、地址/购买/取消完整登录态浏览器流程、管理员完整浏览器流程、移动端键盘及视觉验收未执行。
- 默认关闭门控的完整自动化测试虽在各模块单测中覆盖部分逻辑，但不能替代上述隔离数据库和运行时检查。

首轮验证期间未修改业务代码或环境文件。测试过程中由迁移配置生成的临时快照文件均已清理；最终 `git diff --check` 及本计划文档格式检查通过。后续修复与复测结果见下节。

### 修复复测（2026-11-11）

针对上表中可修复的失败项完成定向复测。复测使用独立 tmpfs PostgreSQL 容器和空数据库，没有连接开发数据库。

| 验证项                   | 修复与复测结果                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 商品试穿设置 Migration   | 修正测试对迁移集合的断言，并修复 `Migration20261109120000.down()` 的反向外键删除顺序。隔离 PostgreSQL 用例 1 passed、0 failed；验证完整升级、历史数据保留和新增字段约束。                                          |
| 聊天购买 Migration       | 同一回滚顺序修复后，隔离 PostgreSQL 用例 1 passed、0 failed；全量升级、回滚到 `Migration20261107100000`、再次升级均成功。                                                                                          |
| 偏好与记忆 PostgreSQL    | 修正假 LLM trace fixture，并在多轮集成测试间清空 EntityManager identity map，模拟真实请求边界；保留原记忆任务断言。用例 1 passed、0 failed。                                                                       |
| 聊天展示/流式 PostgreSQL | 修正 HTTP 测试 LlmService 缺失 graph factory 的 fixture，使 ChatRecordsService 动态传入的工具能够装配到测试模型。HTTP + PostgreSQL 用例 1 passed、0 failed，覆盖 SSE 工具流、最终 trace 绑定、历史权限和事务回滚。 |
| API 全量自动化           | 265 passed、0 failed、15 skipped；跳过项仍是关闭门控的 PostgreSQL/Migration 用例。                                                                                                                                 |
| 仓库质量门禁             | `pnpm check` 通过：Prettier、API/Web/Shared 类型检查及构建均通过。                                                                                                                                                 |

上述测试夹具修正不放宽业务断言；迁移 down 修正为业务迁移代码变更。真实供应商调用和已认证浏览器全流程仍未执行，见“未执行或未验证”。
