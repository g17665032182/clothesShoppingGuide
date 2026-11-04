# 用户长期记忆实施文档

## 完整拆分修订说明（2026-11-04）

本文件记录此前混合方案的历史实施与交付。[完整拆分设计](./user-preference-memory-separation-design.md)、独立契约、[拆分技术文档](./user-preference-memory-separation-technical.md) 和 [拆分实施文档](./user-preference-memory-separation-implementation.md) 均已确认并实施；当前文件所有权、架构及实际验收记录以新的拆分实施文档为准。

## 状态与审批边界

- 状态：已确认，实施中
- 设计文档：[用户长期记忆设计文档](./user-memory-design.md)，已确认
- CRUD 契约：[用户长期记忆 CRUD 契约](../contracts/user-memory-crud-contract.md)，已确认
- 技术文档：[用户长期记忆技术文档](./user-memory-technical.md)，已确认
- 当前阶段：实现与集成
- 下一阶段：完成自动化验证、可用环境下的 Smoke Test，并记录交付结果
- 实施限制：实现须遵守本文范围、文件所有权和验证约定；范围变化需回到对应文档确认
- 最后更新：2026-11-03

本文规划在现有结构化用户偏好模块上新增 Markdown 记忆能力。现有偏好数据、API、页面和聊天接线均已存在；不得按旧实施文档重建模块或覆盖工作区已有修改。

## 开发流程总览

```text
实施文档确认
  -> 主代理记录工作区基线并检查七牛依赖/API
  -> 对象存储适配器、配置和依赖接线
  -> 文档领域 API、元数据实体和数据库迁移
  -> 静默提取、文档补丁和任务幂等
  -> 聊天上下文读取及清空代次接线
  -> Markdown 编辑页面和 Axios API 扩展
  -> 单元、HTTP、迁移和聊天链路验证
  -> 主代理集成、全量检查和 Smoke Test
  -> 更新交付记录
```

阶段按依赖顺序推进。只有文件所有权互不冲突的工作可以并行；任何阶段发现数据、权限、API 或行为与已确认文档不一致时，暂停实现并回到受影响的最早文档阶段重新审批。

## 当前代码基线

- 后端 `apps/api/src/user-memory/` 已有 Controller、结构化偏好 Service、设置、任务、提取器、调度器、读取器、生命周期和模块注册。
- 前端已有 `apps/web/src/pages/memories/` 页面、编辑组件，以及 `apps/web/src/api/modules/memories.ts` 和对应类型。
- `apps/api/src/chat-records/` 已依赖记忆模块读取器、任务服务和生命周期服务；`apps/api/src/app.module.ts` 已注册记忆模块。
- API 已有 `test`、`typecheck`、`build` 脚本；Web 有 `typecheck` 和 `build`，当前没有 Vitest、Vue Test Utils 或 Playwright 测试基础设施。
- API 已新增官方 `qiniu` SDK `7.15.2`；已复核 SDK 当前 Node.js、区域、上传、私有下载和删除 API 文档。
- 每次代理启动前重新运行 `git status --short`；本节只记录本次调查快照，不代表之后工作区状态不变。

## 子代理角色和文件所有权

主代理为所有共享文件的唯一所有者。代理不得修改表外文件；发现需要调整公共接口或数据契约时，先报告主代理，不得自行扩展范围。

| 角色         | 独占文件范围                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 主要职责                                                                                                           | 明确禁止                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 对象存储代理 | `apps/api/src/user-memory/service/user-memory-document-store.service.ts`；该服务专属的 `apps/api/src/user-memory/spec/user-memory-document-store.service.spec.ts`                                                                                                                                                                                                                                                                                                                           | 封装七牛 SDK、配置读取接口、私有对象上传/读取/删除、对象键派生和可替换测试端口；不在适配器中承载文档业务规则       | 不修改环境示例、依赖清单、锁文件、实体、迁移、Controller、模块注册或其他代理文件               |
| 文档领域代理 | `apps/api/src/user-memory/controller/user-memory.controller.ts`；`apps/api/src/user-memory/service/user-memory-document.service.ts`；`apps/api/src/user-memory/entity/user-memory-document-state.entity.ts`；`apps/api/src/user-memory/dto/user-memory-document.dto.ts`；`apps/api/src/user-memory/context/memory-document.schema.ts`；`apps/api/src/user-memory/context/memory-document-patch.schema.ts`；`apps/api/src/user-memory/context/memory-safety.ts`；对应的文档 API/Service spec | 实现 Markdown 读取、更新、清空、并发 revision、用户归属和敏感内容校验；复用现有鉴权、Zod Pipe 和偏好开关           | 不修改 `user-memory.module.ts`、MikroORM 配置、迁移、任务处理、聊天、LLM、前端或其他代理的测试 |
| 提取任务代理 | `apps/api/src/user-memory/service/user-memory-extractor.service.ts`；`apps/api/src/user-memory/service/user-memory-task.service.ts`；`apps/api/src/user-memory/service/user-memory-scheduler.service.ts`；`apps/api/src/user-memory/task/**`；`apps/api/src/user-memory/spec/user-memory-extractor.service.spec.ts` 和任务相关 spec                                                                                                                                                         | 扩展现有异步任务以生成、过滤、应用幂等 Markdown 补丁；遵守清空 generation 和共享设置开关                           | 不修改实体、迁移、文档 Service/Store、`ChatRecordsService`、模块注册、前端或其他代理的测试     |
| 前端代理     | `apps/web/src/pages/memories/**`；`apps/web/src/api/modules/memories.ts`；`apps/web/src/api/types/memories.ts`                                                                                                                                                                                                                                                                                                                                                                              | 在现有记忆页增加 Markdown 原文编辑、预览、保存冲突、清空确认和错误状态；沿用 Axios、MarkdownRenderer 与 shadcn-vue | 不修改路由、AppShell、共享 UI、API 底座、后端或测试基础设施                                    |
| 测试代理     | `apps/api/src/user-memory/spec/**` 中不归属其他代理的新增 spec 和 `spec/fakes/**`                                                                                                                                                                                                                                                                                                                                                                                                           | 编写领域边界、模块 HTTP、权限、并发和迁移集成测试替身；核对测试不依赖真实七牛凭据                                  | 不修改生产代码、实体、迁移、聊天/LLM 模块、前端、包清单或锁文件                                |
| 主代理       | `apps/api/src/user-memory/user-memory.module.ts`；`apps/api/src/mikro-orm.config.ts`；`apps/api/src/database/migrations/**` 中本功能新迁移；`apps/api/src/chat-records/**`；`apps/api/src/app.module.ts`；`apps/api/src/llm/**` 中必要接线；`apps/api/package.json`、`apps/api/.env.example`、`pnpm-lock.yaml`；路由或导航确需调整时对应公共文件；文档                                                                                                                                      | 依赖和环境配置、MikroORM 注册、迁移、跨模块接线、文件所有权协调、集成验证及交付记录                                | 不覆盖或回滚已有用户修改；不扩大记忆模块公开接口；不把密钥写入跟踪文件                         |

不得将 `user-memory.module.ts`、迁移、SDK 依赖或 `.env.example` 同时分给其他代理。若实施时需要扩展上述范围，先由主代理调整本表并再次检查无重叠。

## 子代理开始前检查

1. 实施文档已获用户明确确认；当前设计、CRUD 契约和技术文档版本一致。
2. 阅读仓库 `AGENTS.md`、相关应用 README、目标模块代码和包脚本，并检查 `git status --short`。
3. 阅读技术文档列出的七牛官方文档与项目当前 Nest、MikroORM、Zod、Axios、Markdown Renderer 使用方式。
4. 确认对象存储适配器不向前端暴露 Bucket、对象键、AK/SK、上传 token 或私有下载签名 URL。
5. 确认必要代码注释使用中文；日志不得包含 Markdown 正文、完整聊天内容、模型原始输出或任何凭据。
6. 自动化测试使用 fake 对象存储和模型端口，不依赖真实七牛凭据或不可控外网；需要真实服务的验证明确标记为 Smoke Test。

发现技术文档与现有运行时能力冲突时，停止受影响阶段并报告，不自行替换 SDK、数据结构或接口契约。

## 子代理完成报告

每个代理完成后按以下格式向主代理报告：

```text
修改文件
- <相对路径>

执行命令
- <实际执行的命令>

测试结果
- <通过、失败或未执行，以及关键输出>

未解决风险
- <风险或“无”>

越界修改
- <文件和原因，或“无”>
```

主代理检查报告中的文件边界、`git diff --check` 和可复现验证结果后，才接受该阶段交付。

## 主代理集成任务

1. 在 `apps/api/package.json` 添加官方 `qiniu` 依赖并更新 `pnpm-lock.yaml`；核对 SDK 模块格式与当前 Node.js 22 / ESM 构建兼容性。
2. 在 `apps/api/.env.example` 增加 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`、`QINIU_BUCKET`、`QINIU_DOMAIN` 和可选 `QINIU_REGION` 占位配置；不写真实密钥。
3. 将对象存储适配器注册到现有 `UserMemoryModule`；将新增状态实体注册到 MikroORM 配置，检查 Nest provider 依赖图无循环引用。
4. 创建独立 MikroORM migration：文档状态表、对象键与摘要字段、任务 generation、文档操作幂等结果表及相关约束/索引；审阅 SQL、外键和 down 顺序。
5. 在现有聊天与记忆公开端口上接入 Markdown 读取、静默补丁应用和 generation 校验；聊天模块不得直接访问存储 Service、Repository 或 Entity。
6. 在现有页面中接入 Markdown 编辑工作流，保留结构化偏好功能、现有记忆开关和已有 API 行为。
7. 集成各代理修改，检查用户归属、服务端对象键派生、签名 URL 脱敏、存储错误映射、并发冲突和清空后的旧任务隔离。
8. 更新相关技术/实施交付记录仅在实现完成后进行；实现期间保持文档所描述范围与代码一致。

## 按顺序排列的实施阶段

### 阶段 0：基线、依赖和对象存储 API 验证

**负责者：** 主代理。

**实施内容：**

- 记录 `git status --short`、现有迁移状态、API/Web 基础检查结果和本地数据库可用性。
- 复核七牛 SDK 当前版本、Node.js 22 兼容性、区域发现、上传、私有下载、对象删除和错误行为。
- 确认实际 Bucket、区域、服务端下载域名及运行环境密钥注入方式；密钥只由环境提供。

**完成标准：**

- 依赖和 SDK 方法均有官方文档依据，未依赖猜测的 SDK API。
- 自动化测试可以在没有七牛账户和密钥的环境下运行。
- 基线及已有工作区修改已记录，没有覆盖或回滚用户内容。

### 阶段 1：对象存储适配器和配置接线

**负责者：** 对象存储代理；主代理拥有依赖、环境示例和模块注册。

**实施内容：**

- 实现窄的对象存储能力：生成服务端对象键、上传不可变对象、服务端代理读取、删除孤儿对象。
- 私有下载签名仅在服务端生成并即时使用；不返回客户端、不打日志。
- 统一处理配置缺失、权限错误、限流、超时和对象不存在等可分类错误。

**完成标准：**

- 适配器不依赖文档实体或 Controller；业务层通过注入端口调用对象存储。
- 对象键仅由服务端用户 UUID、revision 和随机后缀生成；调用方不能指定 Bucket 或任意对象键。
- fake 覆盖上传、读取、删除、超时、权限失败和签名安全。

### 阶段 2：文档领域 API、状态实体和迁移

**负责者：** 文档领域代理；主代理负责模块注册及迁移。

**实施内容：**

- 扩展现有 Controller，提供 `GET/PUT/DELETE /api/memories/document`，复用现有 JWT Guard、`@CurrentUser()` 和 Standard Schema 校验 Pipe。
- 实现 Zod strict schema、UTF-8 字节上限、敏感内容检查、response DTO 和 document Service。
- 新增 `UserMemoryDocumentState` 状态实体，记录 revision、object key、generation、摘要和更新时间。
- 实现 PostgreSQL 锁下的 revision 检查、对象上传后切换数据库指针、清空后延迟清理。

**完成标准：**

- 未知字段和非法内容返回约定 `400`；revision 冲突返回 `409`；对象服务失败返回 `503`。
- 仅当前认证用户可读写自己的文档；响应不含对象键、签名 URL、凭据或内部状态字段。
- 迁移 `up/down` 经 SQL 审阅，并在可销毁的专用测试数据库验证；不运行 `migration:fresh` 清理用户数据库。

### 阶段 3：静默提取和任务幂等

**负责者：** 提取任务代理；主代理负责实体迁移与模块接线。

**实施内容：**

- 扩展现有 extractor/task/scheduler，生成受 Zod 约束的有限 Markdown `append/replace/delete` 操作，不让模型输出全文覆盖。
- 按服装、穿搭和购物优先，其他长期个性化背景为辅；过滤临时信息、低置信度内容和健康、身份、财务及认证敏感内容。
- 将 operation key 写入独立的文档任务结果表，保证重试不重复应用。
- 在应用前重新检查记忆开关和 `document_generation`；清空前登记的旧任务不得恢复 Markdown 内容。

**完成标准：**

- 重复任务和部分成功后的重试幂等；未唯一匹配的 replace/delete 安全跳过。
- 手动编辑并发时对最新版本应用补丁，不覆盖用户内容。
- 模型错误、对象存储错误或任务重试不会改变已经完成的聊天响应。

### 阶段 4：聊天读取与跨模块集成

**负责者：** 主代理。

**实施内容：**

- 在现有 `UserMemoryReaderService` 读取相关 Markdown 块并与结构化偏好合并，沿用技术文档确定的总上下文预算与优先级。
- 扩展现有聊天事务内的任务登记，携带当前文档 generation；读取失败时跳过记忆并继续普通聊天。
- 保持 `chat_messages`、trace 和聊天 API 响应现有语义不变。

**完成标准：**

- 聊天模块只通过记忆模块公开端口读取或登记任务。
- 记忆关闭后不读取、不注入且不应用结构化或 Markdown 提取结果。
- 通过真实 HTTP/数据库链路验证聊天持久化、任务登记、提取候选应用和后续上下文读取；若真实模型不可用，清楚标记未覆盖的部分。

### 阶段 5：Markdown 记忆管理页面

**负责者：** 前端代理。

**实施内容：**

- 在 `apps/web/src/pages/memories/` 现有页面上新增 Markdown 视图，不重建偏好 CRUD。
- 通过现有 `src/api/modules/memories.ts` 和 API 类型访问文档 API；编辑原始 Markdown，提供安全预览、保存、冲突处理和独立清空确认。
- 明确管理页加载、空文档、读取失败、dirty、saving、saved、conflict、提交失败和清空状态。

**完成标准：**

- 使用 `MarkdownRenderer.vue` 的 sanitize 能力；不使用 `v-html`、不关闭 sanitizer、不将签名 URL 或对象键注入界面。
- `409` 时保留草稿，不自动覆盖远端版本；防重复提交，过期响应不能覆盖当前草稿。
- 结构化偏好页面、用户记忆开关和现有记忆操作保持可用。

### 阶段 6：测试、集成检查和 Smoke Test

**负责者：** 测试代理负责模块测试；主代理负责迁移、HTTP 和全链路验证。

**实施内容：**

- 测试 Zod schema、Standard Schema Pipe 的 HTTP 400、用户隔离、revision 冲突、对象存储失败、任务重试、敏感过滤和清空竞态。
- 使用 fake 七牛适配器与 fake 模型端口运行自动化测试，不要求真实凭据或外网。
- 因当前 Web 尚无 Vitest/Vue Test Utils/Playwright 基础设施，不在本任务擅自新增测试框架；运行现有 typecheck/build，并按条件进行浏览器手工 Smoke Test。
- 对配置真实七牛凭据的验证只运行于明确授权的非生产环境，记录实际验证环境，禁止打印或写入密钥。

**完成标准：**

- 服务端测试覆盖 schema/HTTP、授权边界、对象状态一致性、任务幂等及代次隔离。
- API typecheck/test/build 和 Web typecheck/build 均有真实运行结果。
- `pnpm format:check`、`pnpm check` 和 `git diff --check` 的结果如实记录；对既有或未修改文件造成的格式失败，说明具体路径，不进行无关重排。
- Smoke Test 验证私有对象不可匿名读取、跨用户隔离、两 API 实例并发、清空与旧任务竞态以及备份指针一致性。

## 验收标准

### 文档、权限与安全

- 已有结构化服装偏好继续可用；每位用户最多一份独立 Markdown 文档。
- 文档以服装、穿搭、购物信息为主，其他长期个性化背景为辅；不写入健康、身份、财务或认证敏感信息。
- Bucket 为私有空间；客户端不能指定或获得对象键、下载签名 URL、AK/SK。
- 游客、其他用户和普通管理员接口不能读取文档原文。

### 持久化、并发与任务

- PostgreSQL 只保存文档状态及对象指针，不保存 Markdown 正文。
- 新对象上传成功后才切换数据库指针；对象上传或数据库事务失败时，之前有效版本仍可读取。
- 手工编辑使用 `expectedRevision`，并发冲突返回 `409` 且不丢本地草稿。
- 清空递增 generation 并让读取立即变为空；旧任务不能复活 Markdown 文档，旧对象清理由延迟任务安全重试。
- 聊天完成不等待提取；对象存储或模型失败不阻断普通聊天。

### API、前端和验证

- `GET/PUT/DELETE /api/memories/document` 仅从当前认证用户确定资源归属。
- API schema、未知字段、字节长度、敏感内容和错误映射符合已确认技术文档。
- 页面支持原始 Markdown 编辑和 sanitize 预览，正常处理加载、空状态、保存、冲突、错误和清空。
- 自动化测试不依赖真实七牛密钥；数据库迁移、安全边界和关键聊天工作流有实际验证记录。

## 风险和停止条件

- 七牛 SDK 版本、Node ESM 兼容性、Bucket 区域或私有下载 API 与技术文档不符。
- 生产 Bucket、区域、下载域名、最小权限 AK/SK、密钥轮换或备份策略尚未明确。
- 对象存储与 PostgreSQL 指针可能出现部分失败；若无法实现可重试的孤儿清理和状态核对，不得上线写入。
- 数据库实体/迁移、任务幂等、清空 generation 或用户归属与已确认契约不一致。
- 当前 HTTP/数据库/LLM 链路无法验证任务登记、执行、结果反馈和后续读取。
- 自动化测试被迫依赖真实生产凭据或不可控外网。
- 实施需要改变已确认 API、数据语义、隐私范围或现有结构化偏好行为。

遇到上述情况暂停对应阶段，给出复现信息和受影响文件，回到适当审批阶段，不用临时兼容层绕过。不得将未执行或失败的检查记为通过。`migration:fresh` 仅可用于明确可销毁的本地或 CI 数据库。

## 实施交付记录

- 状态：实现完成，进入交付验证。
- 已完成：七牛对象存储适配器、Markdown 文档 API、revision/generation 并发控制、延迟清理队列、聊天后静默补丁提取、512 token 记忆上下文接线，以及前端 Markdown 编辑/预览/冲突处理/清空流程。
- 依赖与配置：API 新增 `qiniu@7.15.2`；`.env.example` 已增加七牛占位配置，未写入真实凭据。
- 数据库：已新增 `Migration20261103130000`；在临时数据库 `csg_memory_test_20261103` 完成全量迁移验证，验证后已删除临时数据库。
- 自动化验证：API typecheck、API build、API 86 项测试、Web typecheck、Web build、定向 Prettier 和 `git diff --check` 通过。
- 未覆盖：未使用真实七牛凭据进行联调，未执行真实模型的完整提取链路和浏览器级 Playwright 验证；`pnpm format:check`/`pnpm check` 仍受仓库既有未修改文件 `apps/api/src/database/migrations/.snapshot-clothes_guide.json`、`apps/api/src/llm/context/system-context.md` 的格式检查影响。
