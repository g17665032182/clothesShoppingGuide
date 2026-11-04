# 用户偏好与用户记忆完整拆分实施文档

## 状态与审批边界

- 状态：待用户确认。
- 最后更新：2026-11-04。
- 已确认：[完整拆分设计](./user-preference-memory-separation-design.md)、[偏好契约](../contracts/user-preferences-crud-contract.md)、[记忆契约](../contracts/user-memory-crud-contract.md)、[完整拆分技术文档](./user-preference-memory-separation-technical.md)。
- 当前阶段：实施规划；本文分工、文件路径和验收项是计划，不代表已经实现。
- 确认本文后：按文件所有权启动子代理开发，由主代理集成、执行迁移与验证并记录结果。
- 本轮仅修改文档，不启动子代理，不修改业务代码、测试、配置或数据库。

本文沿用已确认技术方案，不重新审批路由、独立开关或数据规则。如果实施发现必须改变数据、权限、API 或迁移语义，回到对应文档说明影响后确认。

## 开发流程总览

```text
实施文档确认
  -> 主代理记录基线、核对本地库与官方文档
  -> 主代理准备公开端口、聊天来源只读能力与基础设施入口
  -> 偏好 / 记忆 / 前端三个子代理并行开发
  -> 子代理释放文件所有权并提交验证报告
  -> 主代理接线、删除旧混合实现、生成并审查 Migration
  -> 专用测试库验证历史数据升级、并发与隔离
  -> 可销毁本地库执行 fresh 和 Seed
  -> 全量检查、运行时 Smoke Test
  -> 更新交付记录
```

最多同时运行三个子代理，主代理保留集成职责。数据库升级、旧文件删除和应用重启必须在相关代码集成后顺序执行，不能让半拆分代码连接已经切换的 schema。

## 子代理角色和文件所有权

下文路径相对仓库根目录。目录授权包括其中新增文件；明确排除的文件始终归主代理。任何移动操作都需要分别拥有源文件和目标文件，否则先复制必要逻辑，再由源文件所有者删除。

### 主代理：公共接口、跨模块集成和数据迁移

主代理独占以下文件和目录：

- 两个领域的 `index.ts`、`port/`、`user-preferences.module.ts`、`user-memory.module.ts`，先确定窄接口，再完成最终 provider 注册。
- `apps/api/src/chat-records/` 全部文件，包括新的 `extraction-source/`、上下文预算、聊天事务接线与所属测试。
- `apps/api/src/users/` 必要的公开有效用户查询、模块导出和对应测试；不改变用户管理 API。
- `apps/api/src/common/security/sensitive-text.ts` 及必要的纯工具测试。
- `apps/api/src/app.module.ts`、`apps/api/src/mikro-orm.config.ts`、`apps/api/src/database/`，以及新的基础设施环境加载文件与配置测试。
- `apps/api/src/user-memory/` 下保留待移除的旧混合文件：`controller/user-memory.controller.ts`、`dto/memory-id.dto.ts`、`dto/user-memory.dto.ts`、`entity/user-memory.entity.ts`、`entity/user-memory.mapper.ts`、`entity/user-memory-task-result.entity.ts`、`service/user-memory.service.ts`、`service/user-memory-lifecycle.service.ts`、`context/memory-value.schema.ts`、`context/memory-context.formatter.ts`。
- 旧结构化测试 `spec/memory-domain.spec.ts`、`spec/memory-preferences.schema.spec.ts`、`spec/user-memory.service.spec.ts`；先核对偏好模块已承接覆盖，再移除。
- `apps/web/src/api/types/index.ts` 的必要导出，以及上述子代理目录外因本次重命名产生的调用方引用。
- 根配置、包清单、锁文件、环境示例、README 和本次文档。默认不新增依赖，不改真实密钥。

Migration 与 snapshot 路径以当前 ORM 配置为准。新增 Migration，不修改已经执行的历史文件；生成 snapshot 只保留本次 schema 的必要差异。

### 子代理 A：用户偏好领域

所有权为 `apps/api/src/user-preferences/`，排除主代理保留的 `index.ts`、`port/` 和模块文件。

负责 Controller、DTO/schema、偏好/设置/任务/结果 Entity、Mapper、CRUD、生命周期、读取器、提取器、调度器及所属 `spec/`。读取旧混合文件迁移规则，不修改或删除它们。

交付要求：

- 偏好路由统一为 `/api/preferences`，设置独立，手动管理不受关闭影响。
- 独立任务、候选缓存、租约、重试、领域锁与模型提示；不引用记忆领域。
- 删除全部偏好只取消本领域任务，在途任务不能回写。
- 通过聊天只读端口取消息，不读取聊天私有表；后台入口有 RequestContext。
- 保留类别、值约束、来源、主偏好、指纹和旧 operation_key 语义。
- 补充独立 schema、真实 Nest HTTP、权限、业务与任务测试。

不得修改迁移、其他领域、聊天接线、公共端口、包清单或旧文件。需要改变端口时先向主代理报告。

### 子代理 B：Markdown 记忆领域

所有权为 `apps/api/src/user-memory/`，排除主代理明确保留的公开入口、模块和旧混合文件/测试。

负责新的文档/设置 Controller、`dto/memory-settings.dto.ts`、现有文档 DTO、保留的五类 Entity、文档与设置服务、任务/提取/调度/读取服务、存储/清理服务、文档/补丁/候选 schema、`memory-safety.ts`、`task/` 和其他所属 `spec/`。

交付要求：

- 只提供 Markdown 文档和记忆设置，移除结构化候选、偏好值和共用开关逻辑。
- 独立模型调用、候选缓存和租约检查；文档存储失败不依赖偏好状态。
- generation、revision、对象指针和清理协议保持有效；清空后旧任务不能恢复内容。
- 调度与对象清理入口均建立独立 RequestContext，处理有界退出和安全故障分类。
- 通过聊天只读端口取消息，敏感文本检测复用主代理提供的纯工具。
- 补充独立 schema、真实 Nest HTTP、文档冲突、权限、候选和生命周期测试。

不得修改偏好模块、迁移、聊天接线、公共端口、主代理保留的旧文件或包清单。

### 子代理 C：前端必要适配

所有权为 `apps/web/src/pages/memories/`、`apps/web/src/api/modules/preferences.ts`、`apps/web/src/api/types/preferences.ts`、`apps/web/src/api/modules/memories.ts`、`apps/web/src/api/types/memories.ts`。

负责偏好类型和 API 独立命名、页面组合及 `usePreferences` / `useMemoryDocument`、独立设置和异步状态、现有私有组件的必要类型适配。

交付要求：

- 保留现有两个视图和导航，不扩展页面范围。
- 两类开关、加载、提交、错误和取消互相独立，列表旧响应不能覆盖新开关。
- 保留 KeepAlive 草稿、文档冲突处理与安全预览，处理 activated/deactivated/unmounted 生命周期。
- 使用现有 Axios 和 UI 组件，显式声明组件 Props/Emits，防重复提交及过期响应。
- 不保留将偏好称为 MemoryRecord 的兼容别名；API/Web 类型检查与构建通过。
- 不安装前端测试框架，不新增前端测试脚本；记录需要浏览器验证的路径。

不得修改后端、认证底座、路由组织、UI 基础组件、公共类型聚合入口或包清单。发现目录外引用时报告给主代理。

## 子代理开始前检查

实施批准后，主代理先完成以下准备，再派发任务：

1. 记录 Git 基线和现有运行进程，保护用户改动；重新核对 AGENTS、README、包版本及相关模块。
2. 阅读本地 Nest、MikroORM、Zod、模型端口及现有任务实现；根据技术文档的官方资料核实实际调用方式，优先复用本地能力。
3. 确定两领域公开 token、输入类型、端口及聊天来源只读接口；不导出 Entity 或私有服务，不用临时空实现掩盖未完成业务。
4. 完成聊天来源叶子模块、用户有效性查询及纯敏感文本工具，明确后续模块注册方式；检查无循环依赖。
5. 明确前端响应类型和路径与契约一致，发送每个子代理精确所有权及禁止修改范围。
6. 共享公共文件由主代理维护。收到文件变更请求后先协调；不得两个执行者同时修改同一文件。

两个领域可复用基础设施类型，不得为了共享 DTO、任务或模型响应而建立第三个业务模块。后端相对导入继续使用 `.js`，必要注释用中文。

## 子代理完成报告与所有权交接

每个子代理按以下格式报告，未执行的检查必须明确标记：

```text
修改文件：
执行命令：
测试结果：
未解决风险：
越界修改：
已释放的文件所有权：
```

主代理收到报告后审查实际 diff，再接收所有权。需要返工时重新明确文件归属；修复或独立测试任务只能在原所有者释放相关路径后派发，不再同时保留两个写入者。

## 按顺序排列的实施阶段

### 阶段一：公开边界与基础设施准备

由主代理执行开始前检查，搭建窄接口和聊天来源叶子模块。统一环境加载入口，确保 Nest、ORM CLI、Seed 都遵循进程环境 > `.env.dev` > `.env`；不通过 shell source 代替代码配置。

阶段完成条件：依赖方向与技术文档一致，接口明确可供领域开发；配置测试不读取真实凭据，不输出密码或连接串。此时不执行迁移或运行半成品应用。

### 阶段二：三条独立开发线

启动 A、B、C 三个子代理。主代理同时在自己负责范围补充聊天上下文组合、双任务登记、会话删除通知及对应测试；不得代改子代理正在持有的文件。

两类任务均落实以下协议：

- 独立轮询、启动/周期恢复、最大四次、1/5/30 分钟退避、30 秒模型超时。
- 领取使用短事务和 SKIP LOCKED；候选保存、应用及状态更新复查 `(taskId, attempts, lockedAt)`。
- 验证和过滤后的候选先持久化再应用，重试复用候选；空数组与未生成状态可区分。
- 成功、最终失败、取消或 generation 失效时清除候选，日志不持久化原始输出或正文。
- 锁顺序为领域 advisory lock → 任务 → 设置/资源/结果；模型调用在事务外。

阶段完成条件：三个报告齐全，领域测试具备实际结果，公共接口冲突由主代理解决。

### 阶段三：主代理集成与旧实现移除

按偏好、记忆、聊天、前端顺序集成：

1. 注册各自 Entity、Controller、provider 和窄端口，确认同一表只有一个 Entity 映射。
2. 聊天顺序登记两类任务，每次使用显式 `TransactionPropagation.NESTED` savepoint；可恢复失败回滚对应 savepoint，外层失败回滚消息和两类任务。
3. 上下文通过独立 reader/fork 与 `Promise.allSettled` 获取；偏好优先，Markdown 使用剩余预算，总计含提示与分隔符不超过 512 token，I/O 有界。
4. 会话删除仅调用偏好来源生命周期能力，保持长期数据与会话删除语义。
5. 前端使用各自 API/类型，更新公共导出与目录外引用，确认旧结构化 `/api/memories` 路由不再存在。
6. 对照已迁移规则及测试，删除主代理保留的旧混合文件，清理旧实体构建产物，检查运行时导入无循环、无私有跨域引用。

阶段完成条件：API/Web 类型检查、领域测试和构建通过，schema metadata 可用于生成 Migration。

### 阶段四：Migration 与历史数据验证

主代理生成并审查新增 Migration、外键、索引、约束和 snapshot，按技术文档执行重命名、独立设置复制、任务复制及结果外键切换。保留 UUID、时间、开关、操作键、文档 generation 和对象指针。

使用专用可销毁测试数据库，程序化构建旧 schema 夹具并调用 Migrator 验证升级，不在用户库进行保留数据实验。必须覆盖：

- 开启、关闭、缺少设置的用户，全部任务状态、不同 attempts 和两类结果。
- 可运行且已有部分结果的旧任务导致整个迁移拒绝并回滚；禁止跳过、删除结果或伪造成功。
- 旧 worker 已停止时，无结果的 processing 任务按次数恢复；终态不自动复活。
- 行数、ID、时间、来源、结果引用、唯一索引及 schema metadata 一致。
- `down()` 明确拒绝有损合并，回退方案依赖一致数据库与对象备份。

历史升级操作说明要求维护窗口、停止写入、排空旧任务、退出旧实例；测试使用 fake 模型/对象存储，不要求真实模型或七牛凭据。

### 阶段五：本地 fresh、Seed 与运行时验收

沿用用户已经确认的本地重建方式，核对连接目标确为可销毁本地库后执行 `pnpm migration:fresh`，自动运行 Seed；不改回 `migration:up` 作为日常命令。同一已授权目标无需重复确认，若实际目标不符则停止数据库操作并说明。

验证建表、独立设置、管理员 Seed 与登录。Seed 对已有账号幂等且不覆盖密码，fresh 后密码匹配当前配置；报告只记录验证结果，不输出密码。

依次执行自动化检查和浏览器/API Smoke Test。复用现有服务或选择空闲端口启动完整应用；记录实际访问地址与状态，不连接半迁移数据库。

## 验收标准

| 领域   | 必须取得的证据                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| 边界   | 两模块无相互业务导入；聊天通过公开端口接入；提取器通过来源端口取消息；无重复实体发现                           |
| HTTP   | 真实 Nest 路由验证 schema 绑定、未知字段、转换/默认值和 400；401、越权/缺失 404、冲突 409、存储 503 按契约生效 |
| 开关   | 四种组合均覆盖；各自关闭仅停止提取/注入，手动 CRUD、文档编辑及历史访问仍可用                                   |
| 并发   | 真实 PostgreSQL 覆盖后台 RequestContext、并发领取、过期租约、候选复用、清空/删除与在途任务竞争                 |
| 故障   | 单边模型/存储/读取故障不吞掉另一边结果；单边登记错误经 savepoint 回滚后另一任务可提交                          |
| 原子性 | 外层事务回滚后两任务均不存在；旧 worker 不能提交被回收租约结果                                                 |
| 上下文 | 一边失败另一边保留，偏好优先，含包装的最终内容不超过 512 token                                                 |
| 迁移   | 正常历史夹具保留数据，危险部分结果夹具使升级整体回滚，fresh 与 Seed 均有实际结果                               |
| 前端   | 各自加载/开关/失败/重试、独立删除/清空、关闭后手动管理、409 草稿和 KeepAlive 生命周期可用                      |
| 安全   | 响应无内部字段，任务和日志无原始模型输出、聊天全文、凭据或签名 URL                                             |

前端验证复用现有工具，不安装 Vitest、Vue Test Utils 或 Playwright，不新增前端测试脚本。自动化使用 fake 模型和存储；真实第三方服务验证单列为 Smoke Test，缺少凭据不能写成通过。

实施后执行：

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

真实 PostgreSQL 用例必须在报告中列出实际执行结果，不能将因环境未配置而跳过视为通过。若仓库检查被无关历史 snapshot 格式阻断，记录原始失败与本次文件的定向检查结果，不自行混入无关格式变更。

## 风险和停止条件

- 旧实现没有持久化候选，部分成功且可重试任务必须先由旧版本排空；不能用新模型输出替代旧候选。
- 两套任务独立后不能自动无损合回旧开关与任务；维护升级前需要一致备份。
- 共享数据库或模型服务整体不可用仍会影响两边，故障隔离测试不等同于基础设施独立。
- 若必须改变已确认 API、授权、数据或幂等语义，暂停受影响实现，说明差异并回到对应阶段确认。
- 若数据库目标不是已授权可销毁本地/测试库，停止 fresh；若专用 PostgreSQL 不可用，明确列为未完成验证。
- 当前没有待确认的业务决策；本文待确认的是实施分工、顺序与验收安排。

## 进度与交付记录

- [x] 完整拆分设计和两份 CRUD 契约已确认。
- [x] 完整拆分技术文档已确认。
- [ ] 本实施文档获用户确认。
- [ ] 公开边界与基础设施准备完成。
- [ ] 三个子代理开发、检查与所有权交接完成。
- [ ] 主代理集成及旧混合实现移除完成。
- [ ] 历史迁移、并发隔离和本地 fresh/Seed 验证完成。
- [ ] 全部检查、Smoke Test 和交付记录完成。

交付时记录实际修改、子代理报告、依赖/配置差异、命令与结果、数据库目标类型、迁移与 Seed 证据、运行地址及剩余限制。未执行、跳过或失败的项目分别说明，禁止把本文目标写成已交付结果。
