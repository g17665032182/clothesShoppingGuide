# 对话工具扩展实施文档：本人试穿任务查询

## 状态与依据

- 状态：2026-11-13 用户确认实施计划并要求 agent team 实施；首期代码已完成，业务验证结果和缺口见下文。
- 最后更新：2026-11-13。
- 前置确认：用户已确认[首期设计](./chat-tool-expansion-design.md)、[增量契约](../../contracts/chat-tool-expansion-crud-contract.md)，随后回复“确认”批准[技术方案](./chat-tool-expansion-technical.md)。
- 关联契约：[用户信息查询](../../contracts/chat-user-information-crud-contract.md)、[虚拟试穿](../../contracts/virtual-try-on-crud-contract.md)、[长期记忆](../../contracts/user-memory-crud-contract.md)。
- 验证依据：[环境与验证约定](../../development/validation.md)、[项目全量验证计划](../../testing/project-full-validation-plan.md)的相关部分。

本文记录已确认首期方案的实施与验收，不增加业务范围，也不把未执行用例记作已通过。

## 交付范围

- `get_my_information` 新增显式请求的 `try_on_tasks` section。省略 sections 仍只查询原三类；每页固定 5 条、页码 1–10，支持独立的四状态筛选。
- 试穿领域新增安全元数据查询，限定本人未删除任务、稳定排序和短只读一致性快照；只对当页批量检查本人未删除结果的存在性。
- 工具只返回契约白名单。追踪仅保存筛选、计数和固定错误，activity 与隐藏工具历史沿用原边界。
- 本轮经校验调用试穿任务查询后，两条消息同事务标记为不可自动提取，跳过记忆入队，并由已有来源/摘要规则阻止后续重新读入；下一普通轮次恢复。
- 更新工具说明、服务端上下文、能力清单和真实实施记录。

不交付 SKU/偏好查询、编辑表单、物流、售后、任务详情工具、结果卡片或自动轮询。不新增依赖、HTTP 路由、SSE 事件、前端页面、Entity、索引、迁移和环境配置。不启用真实人像，不创建试穿任务、不访问存储或图像供应商，不部署、不自动提交或推送代码。

## 启动前检查与接口对齐

主代理在本文确认后执行：

1. 重新记录 git status 和各文件现有差异；当前未提交设计、契约和技术文档属于保留内容，不回滚或批量整理无关文件。
2. 阅读 AGENTS、设计、契约、技术文档、本地依赖及当前源码。若版本变化，重新核对安装包声明和官方文档；不引入替代框架。
3. 确认三个角色的独占文件与公共接口，标明新增文件只是计划、尚不存在。代理只能修改其所有权范围。
4. 检查隔离库、连接方式、测试实际读取的变量与清理边界；不得输出凭据，不对默认库运行迁移、Seed 或业务写入。
5. 公共接口对齐后再并行开发依赖方，不能提交假成功占位实现。

| 公共接口或规则                                    | 提供方 | 对齐要求                                                                 |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `TryOnTaskMetadataQuery`、`TryOnTaskMetadataPage` | A      | DTO 位于试穿模块，通过公开入口导出；字段、四状态、固定分页与技术方案一致 |
| `listMetadataForUser(userId, query)`              | A      | 用户为服务端独立参数；无资源动作参数、无图片/供应商依赖；返回安全 DTO    |
| `getMyInformationSchema`、解析前后类型            | B      | 默认三类、显式四类、筛选关联和严格未知字段规则固定                       |
| `sections.try_on_tasks` 及 section 错误           | B      | 保持既有 `ok: true` 外层和独立容错；无记录与 unavailable 分开            |
| `onTryOnTasksRequested` 回调与运行标记            | 主代理 | 解析通过后、第一个 await 前置 true；重复/并行调用安全，失败也保留        |
| `memoryExtractionEligible` 与 trace 绑定          | 主代理 | 两条消息和绑定同事务；不覆盖原购买资格条件，不混用模型/数据库消息 ID     |

接口对齐允许先用明确的测试替身验证依赖方，但最终集成必须调用真实 reader。不得将聊天层深层导入试穿 Entity 作为临时接线。

## 代理分工与文件所有权

实施确认后采用 A、B 两个子代理及主代理。当前文档编写由主代理完成，尚未创建子代理。子代理交付不等同于整体验收，主代理统一审阅和集成。

### A：试穿领域只读查询

独占文件：

- 新增 `apps/api/src/virtual-try-on/dto/try-on-task-metadata.dto.ts`。
- 新增 `apps/api/src/virtual-try-on/service/try-on-task-reader.service.ts`。
- `apps/api/src/virtual-try-on/index.ts`、`virtual-try-on.module.ts`。
- 新增 `apps/api/src/virtual-try-on/spec/try-on-task-reader.service.spec.ts`。

任务：定义公开 DTO/schema，提供只读 Service 和 Nest 导出；使用独立 fork、短只读 REPEATABLE READ 事务、稳定分页以及当页批量结果检查。任务与结果查询均限定本人，排除逻辑删除。

验收：单元测试证明分页、四状态、结果缺失/删除/他人记录及最小投影；真实事务与权限由主代理在隔离 PostgreSQL 集成中验证。不得调用现有创建、下载、Worker、额度或存储方法，不编辑原 Entity 或任务写服务。

### B：用户信息 section 与追踪

独占文件：

- `apps/api/src/chat-user-information/dto/chat-user-information.schema.ts`、`chat-user-information-response.ts`。
- `apps/api/src/chat-user-information/service/chat-user-information.service.ts`、模块文件与 `index.ts`。
- `apps/api/src/chat-user-information/spec/chat-user-information.schema.spec.ts`、`chat-user-information.service.spec.ts`。
- `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`。
- `apps/api/src/chat-records/spec/chat-trace-writer.service.spec.ts`。

任务：扩展输入与响应类型，显式分派四类 section；通过公开 Service 读取并二次白名单投影。扩展独立和嵌套调用的 trace 筛选/计数投影，不保存任务 ID 集合或条目。

验收：原三类默认行为不变，未知/重复参数拒绝，tryOnStatus 与 section 关联正确；空列表、部分失败和全失败不混淆；异常原文、照片/图片字段和任务条目不进入 trace。没有白名单的未知字段不得因为通用序列化进入持久化。

### 主代理：运行资格、提示词和集成

独占文件：

- `apps/api/src/chat-records/tools/chat-user-information.tool.ts`、必要的 `purchase-address-coordinator.ts`。
- `apps/api/src/chat-records/service/chat-records.service.ts`。
- `apps/api/src/chat-records/spec/chat-records.service.spec.ts`、`purchase-address-coordinator.spec.ts`、`chat-history.mapper.spec.ts`、`chat-context.service.spec.ts`、`chat-extraction-source.service.spec.ts`。
- 新增 `apps/api/src/chat-records/spec/chat-user-information.tool.spec.ts`、`chat-try-on-information.postgres.spec.ts`。
- `apps/api/src/llm/context/system-context.md`、必要的 `shopping-flow.md`，以及 `llm/spec/system-context.spec.ts`。
- 相关设计、契约、技术、实施、能力清单、README 和验证计划文档。

任务：接入工具回调和每轮标记，维护事务内资格与记忆入队；验证隐藏历史配对及已有摘要/混合来源保护；更新提示词，编写 JWT + fake 模型 + 实际 ToolNode + 真实数据库的跨模块用例。

源码层面的 `history/`、`context/`、`extraction-source/`、`chat-summary-source.ts` 和 `user-memory/` 默认复用，不为新增测试重构它们。若发现已有机制无法满足批准方案，主代理先形成具体证据；仅必要修复才接管对应文件并补回归，不交给其他代理重叠修改。

代理间变更所有权必须先停止原负责人写入并明确移交。共享构建、数据库、开发端口及最终验收由主代理统一串行执行；单元测试可以在不共享这些资源时并行。

## 实施顺序与退出条件

| 阶段             | 工作                                                      | 退出条件                                                 |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| 0：基线          | 确认本文、读取现状、冻结接口、检查验证环境                | 文件所有权和 DTO/错误/回调一致，无未决业务权限问题       |
| 1：领域和 schema | A 完成公开 reader；B 完成严格输入、response 和局部测试    | 公共端口可用，不依赖私有 Entity；三类默认值保持          |
| 2：查询与追踪    | B 接入安全 reader 和 trace；主代理接入回调、资格和提示词  | JSON/SSE 同一身份绑定，任务故障独立，trace/activity 安全 |
| 3：集成复核      | 主代理审阅差异、运行局部及 API 全量测试、仓库检查         | 资格同事务、并行回调安全、旧地址/购买/历史行为无回归     |
| 4：真实链路      | 串行隔离 PostgreSQL、JWT HTTP/fake 工具图及人工浏览器检查 | 所有矩阵项有实际证据，未执行和 skipped 单列              |
| 5：交付          | 同步文档状态、记录真实结果与清理范围                      | 不把代码集成或假模型结果等同于真实模型和浏览器验收       |

阶段 1 在 A 发布 DTO/端口后，B 可与主代理并行推进独立文件；接口变化由主代理裁决并通知所有依赖方。阶段 4 不与任何使用同库或同端口的任务并行。

## 验收矩阵

| 编号 | 验收要求                                                                        | 证据                                                                          |
| ---- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| V01  | 默认三类、显式四类、筛选关联、数字类型/分页、未知字段                           | **通过**：schema、工具和 API 全量测试；HTTP 未知 Body 返回 400                |
| V02  | 本人隔离、两种删除标志、四状态、同时间排序、超过一页和空页                      | **通过**：reader 单测与隔离 PostgreSQL；依真实唯一约束串行切换活动状态        |
| V03  | 任务/总数/结果在只读一致性快照中，结果当页批量读取                              | **通过**：PostgreSQL 断言 REPEATABLE READ、read-only、批量读取及并发快照      |
| V04  | 无照片/URL/对象键/供应商字段；不触发下载、已读、生成或额度变化                  | **通过**：白名单及数据库前后状态断言；测试未注册存储、Worker 或供应商         |
| V05  | 单 section/全部失败、默认不查任务、地址协调独立                                 | **通过**：服务、工具及地址协调器测试覆盖默认三类、空结果、独立失败和混合查询  |
| V06  | 独立/嵌套/非法工具 trace 不含条目；activity 输入输出为 null；历史工具配对隐藏   | **通过**：trace/history 单测及真实 HTTP/SSE 持久化断言                        |
| V07  | 查询成功/空/失败均设置资格；JSON/SSE 两条消息 false、无记忆入队；下一普通轮恢复 | **通过**：单元及隔离 HTTP/PG；同会话普通轮恢复入队，SSE done 时消息已提交     |
| V08  | 混合批次、候选重试及摘要来源无法重新读入被排除轮次                              | **通过**：source/extractor/summary 单测及隔离测试，覆盖模型 ID 与消息 ID 不同 |
| V09  | 实际工具图把安全结果反馈给模型，JWT 401/越权 404，done 在事务提交后             | **通过**：JSON/SSE + PostgreSQL + fake model；401/400/404 与提交后 done       |
| V10  | 桌面/窄屏、空/失败/重试、切账号/会话、进入原试穿页                              | **未执行**：没有可安全启动的登录态浏览器 fake-model harness                   |
| V11  | 原推荐、地址选择、购买弹框、订单及试穿动作兼容                                  | **自动化通过**：API 全量回归；浏览器覆盖未执行                                |

taskId 仅是安全引用，不是下载/动作凭据。resultAvailable 仅表示查询快照中存在有效结果记录，不承诺对象存储或稍后下载成功。

## 隔离数据库与集成测试

新增门控套件位于 `apps/api/src/chat-records/spec/chat-try-on-information.postgres.spec.ts`。复用现有 fake 模型、JWT Guard、Nest 测试接线和 MikroORM 配置，不复制完整应用启动流程。

- 开关：`RUN_CHAT_TRY_ON_INFORMATION_POSTGRES_TEST=1`。
- 库名变量：`CHAT_TRY_ON_INFORMATION_TEST_DB`，测试须显式赋给 ORM `dbName`。
- 计划专用库名：`clothes_guide_chat_try_on_information_test_20261113_phase1`。创建前确认不存在；若有他人资源，使用相同安全前缀的新唯一后缀，记录实际库名，不能接管或清空旧库。
- 测试验证安全前缀并与默认配置库名不同；无开关时 skipped，无安全库名时拒绝执行。
- 只在该库应用既有增量迁移，不生成新迁移，不运行 migration:fresh。
- 准备 owner/stranger、聊天会话、四状态和删除任务、有效/缺失/删除结果等合成数据。结果对象键只是 fixture，不向任何存储请求文件。
- 定制测试模块不注册 Worker、调度器或真实模型/存储供应商 provider。仅关闭生成开关不能替代禁用测试模块中的 Worker。
- 所有 SQL 读写和迁移均只消费显式注入的隔离库；凭据不入命令输出、测试断言和交付记录。

已执行命令（仓库根目录）：

```bash
RUN_CHAT_TRY_ON_INFORMATION_POSTGRES_TEST=1 \
CHAT_TRY_ON_INFORMATION_TEST_DB=clothes_guide_chat_try_on_information_test_20261113_phase1 \
pnpm --filter @clothes-shopping-guide/api exec tsx --test --test-concurrency=1 \
src/chat-records/spec/chat-try-on-information.postgres.spec.ts
```

执行前再审阅测试源码确认实际门控、注入和清理。测试后关闭 Nest、所有 EntityManager/ORM 连接、监听端口和测试进程；只清理本次创建的 fixture。专用库由主代理记录创建来源后清理；验证失败时保留必要诊断状态并报告，绝不扩大到默认库或用户原有库。

## 自动化与浏览器验证

局部单元测试先按所有权执行；集成后由主代理统一运行：

```bash
pnpm --filter @clothes-shopping-guide/api test
pnpm check
git diff --check
```

`pnpm check` 包含全仓格式、类型检查和构建，不含 API test 或被开关跳过的数据库测试。若局部结果之后没有相关修改，不重复运行同一检查；若全仓格式受原有未改文件阻塞，保持该文件并报告，再单独完成 API/Web typecheck/build。

登录态人工验收在具名隔离配置下启动必要服务，先核对端口和数据库，再用合成账号与受控 fake 模型执行 V10。检查普通查询只显示摘要，不触发图片网络请求、购买地址卡或表单。当前没有现成可运行的全站 fake 模型启动配置，需在集成阶段复用测试 harness 或其他现有受控方式；若无法接入浏览器，V10 明确记录为未执行，不为完成验收临时接入真实供应商。

没有前端改动，不安装测试框架。只有实施确实需要启动新服务时才创建本任务进程并提供实际 URL；不假定前轮预览仍存活，不停止用户已有进程。

## 文档同步与报告

本轮已同步以下文档，并保持各自的“已实现”和“已验证”区别：

- `docs/modules/llm/chat-tool-expansion-design.md`、`chat-tool-expansion-technical.md`、本实施文档。
- `docs/modules/llm/chat-tool-capability-inventory.md`：已把试穿查询从候选移入已接入能力，其他候选仍保持未实施。
- `docs/contracts/chat-tool-expansion-crud-contract.md`、`chat-user-information-crud-contract.md`、`virtual-try-on-crud-contract.md`、`user-memory-crud-contract.md`。
- `README.md`：工具实际可用范围；`docs/testing/project-full-validation-plan.md`：实际新增测试入口和门控。
- `apps/api/src/llm/context/system-context.md` 及必要的 `shopping-flow.md`：服务端实际读取的运行提示。

子代理交付格式：

```text
修改文件：
执行命令：
测试结果（通过/失败/跳过/未执行）：
公开接口或接线要求：
未解决风险：
越界修改（没有则写无）：
```

主代理交付包含集成结果、实际命令及数量、数据库名/来源/清理结果、HTTP 和浏览器覆盖、外部服务未执行说明、残余风险与未提交状态。文档中不得保存 token、密码、联系方式、图片或供应商响应原文。

## 风险与停止条件

- 实际需要新增数据结构、公开 API、下载授权或扩大模型权限时，回到受影响设计和契约，不在实施中附带扩展。
- 元数据仍包含图片/对象键、结果没有本人检查、trace 保存任务条目或无法限制默认 section 时，先修复并补验证，不能用提示词代替边界。
- 新标记仅在 SSE 生效、失败未保留、记忆或摘要仍读入被排除轮次时，停止该链路交付。
- 测试库目标无法确认、测试模块可能启动 Worker/供应商、已有资源归属不明时，停止该验证并报告；不改用默认库验证。
- 用户并行改动影响同一文件时先协作合并；只有无法安全区分或继续时才询问，不回滚他人工作。

## 实际执行记录

- 用户于 2026-11-13 确认实施文档并要求使用 agent team。A 完成试穿 reader；B 完成用户信息 section、白名单与 trace；主代理完成工具回调、记忆资格隔离、提示词、跨模块集成及最终复核。文件所有权互斥，由主代理检查接口和集成结果。
- 专用数据库 `clothes_guide_chat_try_on_information_test_20261113_phase1` 经检查原不存在后由主代理创建，并通过 ORM 显式连接。只应用既有迁移，没有新增 Entity、字段、索引或迁移；测试完成后已删除该库。
- 首次数据库测试因 fixture 违反既有“每用户仅一个活动任务”约束失败；保持真实约束并修正 fixture 后，外层测试及 6 个数据库/HTTP 子测试全部通过，失败夹具未改动生产约束。
- reader 单元测试：8 通过、0 失败；信息 schema/service/trace 单测：26 通过、0 失败；主代理聊天定向测试：21 通过、0 失败。
- API 全量测试：349 项，333 通过、16 个既有数据库门控项跳过、0 失败。新门控 PostgreSQL 用例另行开启并通过 7 项（含 6 个子测试），不计入默认套件。
- `pnpm check` 在格式阶段失败：全仓有未修改文件 `docs/modules/chat-purchase/chat-purchase-prd.md` 格式不符合 Prettier。该无关文件保持原样；本任务变更文件定向格式检查通过。随后单独运行 `pnpm typecheck` 和 `pnpm build`，均通过；`git diff --check` 通过。
- 集成使用 fake model 和合成数据；未调用真实 LLM、图像/存储供应商，未启动 Worker，未上传真实照片或创建新试穿任务，未部署、提交或推送。
- V10 登录态桌面/窄屏浏览器验收未执行：无可安全启动的全站 fake-model 浏览器 harness。不得把服务/API 集成测试称为浏览器验收。
