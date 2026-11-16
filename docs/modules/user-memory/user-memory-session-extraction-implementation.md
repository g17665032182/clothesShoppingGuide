# 用户记忆会话批量提取实施文档

## 状态与审批边界

- 状态：已实施，验证完成。
- 日期：2026-11-05。
- 已确认：[会话批量提取设计](./user-memory-session-extraction-design.md)、[用户记忆 CRUD 契约](../../contracts/user-memory-crud-contract.md)增补、[会话批量提取技术文档](./user-memory-session-extraction-technical.md)。
- 确认记录：用户于 2026-11-05 回复“确认”，批准技术方案。
- 当前阶段：实施和验收已完成；实际结果记录于本文末尾。

## 实施目标

按照已确认技术方案，把每轮立即单独提取改为同一会话的有界批量提取：

- 新轮次进入同 generation 下尚未领取、尚无候选的待处理批次，最多每批 10 轮。
- 最后一轮持久化后 5 分钟内不领取；新增轮次重置等待时间。
- 聊天页路由离开、会话切换或新建会话时，尽力提前释放当前会话尚未开始的批次。
- `pagehide` 只作为 best-effort flush；认证失败、网络故障或浏览器生命周期中断不影响聊天操作，5 分钟服务端调度兜底。
- 保留失败重试候选、租约、开关、来源授权、敏感过滤、清空 generation 和文档补丁幂等。

## 非目标

- 不改变用户偏好任务。
- 不改变已经形成的 Markdown 文档、读写 API、七牛对象存储或聊天上下文预算。
- 不增加 Redis、任务队列产品、依赖包或前端测试框架。
- 不要求浏览器关闭事件可靠触发，不等待模型提取结束才允许导航。
- 不对用户或生产数据库执行 `migration:fresh`。

## 文件所有权

本次虽然涉及 API、Migration 和聊天页，但改动量集中在一条任务链路，且批次字段、公开消息来源接口、API 路由、统一 Axios 请求底座及迁移必须协调修改。因此由主执行者单线持有下列改动，不并行修改共享文件。

### API 与数据库

- `apps/api/src/user-memory/entity/user-memory-task.entity.ts`
- `apps/api/src/user-memory/port/user-memory.port.ts`
- `apps/api/src/user-memory/service/user-memory-task.service.ts`
- `apps/api/src/user-memory/service/user-memory-extractor.service.ts`
- `apps/api/src/user-memory/controller/user-memory-task.controller.ts`（新增）
- `apps/api/src/user-memory/dto/memory-task.dto.ts`（新增）
- `apps/api/src/user-memory/user-memory.module.ts`
- `apps/api/src/chat-records/extraction-source/chat-extraction-source.port.ts`
- `apps/api/src/chat-records/extraction-source/chat-extraction-source.service.ts`
- `apps/api/src/user-memory/spec/user-memory-task.postgres.spec.ts`
- `apps/api/src/user-memory/spec/user-memory-extractor.service.spec.ts`
- `apps/api/src/user-memory/spec/user-memory-routes.http.spec.ts`
- 必要时新增 `apps/api/src/user-memory/spec/user-memory-task.service.spec.ts`
- 新增 Migration 与生成的 MikroORM schema snapshot

### Web 与文档

- `apps/web/src/api/modules/memories.ts`
- `apps/web/src/pages/chat/page.ts`
- 如 setup 无法注册路由/页面生命周期钩子，再最小修改 `apps/web/src/pages/chat/index.vue`
- 更新本设计、技术、实施文档和用户记忆契约的状态及实际交付结果

页面调用只通过 memories API module；批量消息只读能力继续归 `chat-records/extraction-source`；记忆 Controller/Service 不直接查询聊天 Entity 或 Repository。后端相对导入继续使用 `.js`。

## 实施顺序

### 1. 基线与依赖核对

- 记录当前 `git status` 和有关文件差异，只在本次确认文件范围内编辑。
- 再检查 `apps/api` 与 `apps/web` 包版本、既有任务/来源实现、migration 当前 snapshot 和测试数据库目标。
- 复用项目 Zod、Nest `StandardSchemaValidationPipe`、Axios `apiRequest`、MikroORM 与专用 PostgreSQL 测试模式，不增依赖。
- 确认专用 Migration 测试库与默认数据库不同；目标不可证实为可销毁测试库时停止 Migration 操作。

### 2. 后端批次登记和来源读取

- 增加任务来源批次 Entity 映射和类型；老行 `source_turns = null` 时继续按现有单轮 ID 处理。
- 在原用户 advisory lock 下，将新来源合入满足 `pending`、`attempts = 0`、候选为空、generation 相同且未满 10 轮的批次；用数据库时间将可领取时间重置为 5 分钟后。
- 新建批次使用首轮来源及现有唯一去重语义；重复轮次不得追加两次。
- 锁定批次行后才合并。若任务已经 `processing`、已有候选或达到上限，则新建后续批次，不修改原租约、来源快照或候选。
- 扩充 `ChatExtractionSource` 公开只读端口，使批量读取校验用户状态、会话归属、消息对归属和角色；为 flush 增加窄的会话归属判定能力，避免记忆模块导入聊天私有实体。
- 提取器对新批次调用 `readTurns`，旧任务继续调用兼容读取路径；候选仍按单任务保存和应用。
- 为 flush 增加 `UserMemoryTaskController` 和 strict Zod DTO；服务先校验会话属于当前用户，再只把 `pending AND attempts = 0 AND candidate_operations IS NULL` 的任务设为数据库当前时间。无可释放任务返回 204，越权/缺失会话统一 404。
- Controller 仅读取 `@CurrentUser()` 并委托 Service，不写查询、锁或任务条件。

### 3. 前端 flush 触发

- 在 `apps/web/src/api/modules/memories.ts` 增加 `flushMemoryTasks`，沿用 Axios Bearer 和认证重试机制。
- 在 `useChatPage` 封装非阻塞、失败隔离的 flush；选中另一会话或开始新会话时先触发对旧 conversation ID 的释放。
- 注册 `onBeforeRouteLeave` 处理离开聊天路由。
- 注册 `pagehide` 尽力请求，使用 Fetch adapter 与 `fetchOptions.keepalive` 并关闭 Refresh 重试；卸载时移除 listener。
- 不使用 `visibilitychange`；不在没有已创建 conversation ID、没有 token 或本轮尚未成功保存的情况下生成虚构 flush。
- flush 失败不得取消导航、覆盖聊天状态或阻止后续消息；重复触发依赖后端幂等。

### 4. Migration 与兼容性验证

- 新增 Migration，仅添加可空 `source_turns jsonb` 及必要类型约束，不回填旧任务，不改变既有状态、attempts、候选、租约、generation、消息 ID 或到期时间。
- Migration snapshot 只保留本次 schema 变化。
- `down()` 不得静默丢弃仍承载多个来源轮次的活动批次；存在无法无损还原的批次时应明确拒绝回滚，并记录恢复要求。
- 在独立 disposable PostgreSQL 数据库测试旧 schema 升级、旧任务读取、批次 Entity metadata、新建和合并任务及回滚保护。
- 不使用普通本地数据库验证 Migration；不执行 `pnpm migration:fresh`。

### 5. 测试、集成与验收

后端聚焦覆盖：

- 同会话合并、5 分钟重置、10 轮上限、重复来源去重。
- 5 分钟未到不可领取、到期可领取；flush 提前释放的范围、204 幂等、400/401/404。
- enqueue/claim/flush 竞争不丢来源、不改 processing 租约。
- 含候选的失败重试不被合并；重试不增加模型调用。
- 老单轮行兼容；关闭开关、清空 generation、用户停用、会话删除和存储失败行为不回退。
- migration 保留既有任务状态和候选，down 的有损保护行为正确。

前端与 HTTP 路径复用仓库现有验证工具，不新增 Vitest、Vue Test Utils、Playwright 或测试脚本。验证离开聊天页、同页切换会话、开始新会话、pagehide、重复 flush、无 token、网络/401 失败及生成中导航。

## 执行命令

在相关实现完成后执行：

```bash
pnpm exec prettier --check <本次变更的文件>
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm check
git diff --check
```

必须显式运行与本次任务有关的 PostgreSQL 用例和专用 migration 升级测试；默认跳过的数据库测试不能报告成通过。执行后记录准确数据库名、命令及结果，不记录任何凭据。基础设施不可用时明确列为未完成。

## 交付记录模板

实施完成后更新本文并记录：

- 实际改动的 API、Web、Migration 文件及数据兼容策略。
- 实际执行的命令和结果，包括专用 PostgreSQL 与 HTTP smoke。
- 服务器启动地址（若启动）；关闭浏览器 `pagehide` 仅 best-effort 的验证限制。
- 未验证项目、剩余风险，以及未执行 `migration:fresh` 的说明。

## 验收门槛

- 同一会话连续多轮最多按每批 10 轮合并，不再每轮立即触发独立模型调用。
- 空闲 5 分钟后后台可自动处理；页面离开时尽力提前处理尚未开始的批次。
- 页面离开通知失败不影响聊天、导航、重试和任务完整性。
- 旧任务、候选幂等、权限和 generation 保护无回归。
- API/Web 检查、Migration 验证、专用 PostgreSQL 测试、`pnpm check` 和差异检查均有实际结果。

## 实际交付记录

- 后端新增 `source_turns jsonb` nullable Migration；旧任务不回填，继续使用单轮字段读取。新任务同会话、同 generation 合并，最多 10 轮，重置 5 分钟静默期；合并与 flush 的实体查询/更新使用 MikroORM EntityManager。advisory xact lock 与现有 `SKIP LOCKED` 批量领取保留为 PostgreSQL 原语。
- 新增 `POST /api/memories/tasks/flush` strict Zod 路由，验证当前用户会话归属后，仅提前释放 pending、零尝试、无候选的任务；无任务和重复请求均返回 `204`。
- `ChatExtractionSource` 扩展会话归属校验与批量来源读取；批量读取使用 ORM 查询并检查消息归属及角色。提取器兼容旧 null 来源任务，并按批次读取新任务。
- Web memories API 通过既有 Axios 请求层触发 flush；切换会话、新建会话、路由离开及 `pagehide` 均尽力触发，失败不阻塞导航。`pagehide` 的 Fetch keepalive 关闭 refresh 重试，仍只作为 best-effort。
- `RUN_PERSONALIZATION_POSTGRES_TEST=1 PERSONALIZATION_TEST_DB=clothes_guide_separation_test_20261104 pnpm exec tsx --test src/user-memory/spec/user-memory-task.postgres.spec.ts`：通过；覆盖 10 轮上限、批次延迟、重复去重、flush 幂等、领取竞争、候选重试和 generation。
- `RUN_SEPARATION_MIGRATION_TEST=1 PERSONALIZATION_TEST_DB=clothes_guide_separation_test_20261105 pnpm exec tsx --test src/database/spec/preference-separation-migration.postgres.spec.ts`：通过。该全新专用库完成历史迁移升级，验证旧行 null 兼容及多轮活跃批次拒绝 down。
- `DB_NAME=clothes_guide_separation_test_20261104 pnpm --filter @clothes-shopping-guide/api migration:up`：在既有专用测试库应用新增 Migration 成功；未对用户日常库执行 `migration:fresh`。
- API 全量 node:test：133 通过、6 跳过、0 失败。跳过项是其他数据库/环境开关用例；本次任务 PostgreSQL 与 migration 用例均另行显式运行并通过。
- API/Web typecheck、API/Web build、记忆 HTTP + extractor 定向测试均通过。仓库级 `pnpm check` 和 `git diff --check` 均通过；`pnpm check` 首次发现本次批量读取文件格式及类型问题，修正后全量重跑通过。
- 未运行真实浏览器 Playwright 或 `pagehide` 生命周期 smoke；keepalive 行为仅由配置和前端构建验证。未启动开发服务器。
