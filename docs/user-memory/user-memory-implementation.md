# 用户长期记忆实施文档

## 状态与审批边界

- 状态：已确认，代码实现完成；真实模型端到端验证待执行
- 设计文档：[用户长期记忆设计文档](./user-memory-design.md)
- CRUD 契约：[用户长期记忆 CRUD 契约](../contracts/user-memory-crud-contract.md)
- 技术文档：[用户长期记忆技术文档](./user-memory-technical.md)
- 当前阶段：实施交付与验证记录
- 实施限制：实施文档已获确认；代码变更必须遵守本文文件所有权、串行阶段和验证要求。
- 最后更新：2026-11-03

本文只规定如何把已确认的技术方案落地为可审查、可回滚、可验证的代码。文档确认后，实施仍必须遵守仓库 `AGENTS.md`、模块开发流程和现有未提交修改保护规则。

## 开发流程总览

```text
实施文档确认
  -> 主代理项目调查与工作区基线
  -> 后端领域基础与 API 骨架
  -> LLM 结构化文本生成端口
  -> 任务领取、提取和重试处理器
  -> 聊天读取、注入和任务登记接线
  -> 前端记忆管理页面与 API 适配器
  -> 单元、HTTP、数据库和全链路测试
  -> 主代理接线、迁移审查和冲突处理
  -> 仓库级验证
  -> Smoke Test
  -> 交付记录
```

实施采用串行阶段。阶段完成前不得开始依赖该阶段输出的下一阶段；阶段之间由主代理检查完成标准后推进。任何阶段发现契约、数据模型、权限或 API 行为需要改变时，立即停止编码，回到受影响的最早文档阶段重新确认。

## 子代理角色和文件所有权

子代理只修改下表中的独占文件范围。主代理负责所有公共接线文件、迁移和最终集成。没有明确列出的文件不得擅自修改。

| 角色         | 独占文件范围                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 主要职责                                                                                                           | 明确禁止                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 后端领域代理 | `apps/api/src/user-memory/user-memory.module.ts`；`apps/api/src/user-memory/controller/**`；`apps/api/src/user-memory/service/user-memory.service.ts`；`apps/api/src/user-memory/service/user-memory-reader.service.ts`；`apps/api/src/user-memory/service/user-memory-lifecycle.service.ts`；`apps/api/src/user-memory/entity/**`；`apps/api/src/user-memory/dto/**`；`apps/api/src/user-memory/context/memory-value.schema.ts`；`apps/api/src/user-memory/context/memory-candidate.schema.ts`；`apps/api/src/user-memory/context/memory-context.formatter.ts` | 落地实体、Zod schema、DTO 类型、手动 CRUD、设置开关、读取端口、生命周期端口和响应 mapper；必要复杂逻辑添加中文注释 | 不修改 `app.module.ts`、MikroORM 配置、迁移、聊天模块、LLM 模块、前端和测试文件              |
| LLM 端口代理 | `apps/api/src/llm/port/structured-text-generation.port.ts` 及该目录下为端口所需的新文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 定义并实现窄的结构化文本生成端口，复用现有模型供应商配置和超时约定，不绑定工具、trace 或用户可见响应               | 不修改 `apps/api/src/llm/llm.module.ts`、聊天图、供应商密钥配置或记忆业务规则                |
| 任务处理代理 | `apps/api/src/user-memory/service/user-memory-task.service.ts`；`apps/api/src/user-memory/service/user-memory-extractor.service.ts`；`apps/api/src/user-memory/service/user-memory-scheduler.service.ts`；`apps/api/src/user-memory/task/**`                                                                                                                                                                                                                                                                                                                    | 实现任务登记、`FOR UPDATE SKIP LOCKED` 领取、模型候选过滤、幂等应用、退避、processing 超时回收和模块销毁清理       | 不修改实体定义、迁移、`ChatRecordsService`、LLM 模块注册、前端或测试文件                     |
| 前端代理     | `apps/web/src/pages/memories/**`；`apps/web/src/api/modules/memories.ts`；`apps/web/src/api/types/memories.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 实现记忆页面、加载/空态/错误/提交状态、结构化值编辑、删除确认和 Axios 适配器；遵守页面目录与中文注释约定           | 不修改 `apps/web/src/router/index.ts`、`AppShell.vue`、共享 UI 基础组件、后端代码或 API 底座 |
| 测试代理     | `apps/api/src/user-memory/spec/**`；为测试专用的新 fake 文件放在 `apps/api/src/user-memory/spec/fakes/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 编写 schema、Service、任务、HTTP 和权限边界测试；不依赖真实供应商密钥                                              | 不修改生产代码、迁移、根配置、聊天模块、前端或包锁文件                                       |
| 主代理       | `apps/api/src/app.module.ts`；`apps/api/src/mikro-orm.config.ts`；`apps/api/src/database/migrations/**` 中本功能新迁移；`apps/api/src/llm/llm.module.ts`；`apps/api/src/chat-records/**` 现有文件；`apps/web/src/router/index.ts`；`apps/web/src/components/AppShell.vue`；包脚本、环境示例、锁文件和文档                                                                                                                                                                                                                                                       | 维护公共文件，完成模块导出和导入、聊天与 LLM 接线、路由和导航、迁移审查、依赖冲突处理、最终验证和交付记录          | 不回滚用户已有改动；不将跨模块私有实现暴露为公共依赖；不跳过审批门槛                         |

同一文件不得同时分配给两个代理。代理需要修改不在所有权表内的文件时，先在完成报告中提出，由主代理决定是否接线；不得直接越界修改。

## 子代理开始前检查

每个代理开始前必须完成以下检查，并把结果写入自己的工作记录：

1. 阅读三份已确认文档和本实施文档，确认当前阶段允许修改的文件。
2. 阅读仓库 `AGENTS.md`、相关应用 README、目标模块现有代码和包脚本。
3. 执行 `git status --short`，识别已有修改；不得覆盖或回滚无关变更。
4. 使用 `pnpm` 检查本地依赖版本和现有实现，优先复用 Zod、Nest `StandardSchemaValidationPipe`、MikroORM、Axios、shadcn-vue 和现有认证能力。
5. 对要使用的框架 API 阅读仓库已记录的官方文档或当前依赖对应文档；不引入 Bull/BullMQ、Redis、Embedding 或向量数据库。
6. 确认新增代码的必要注释使用中文，且不会把密码、Token、API Key、完整聊天原文、模型原始响应或完整记忆值写入日志。
7. 确认测试不调用生产服务、不依赖真实第三方密钥；需要真实数据库或模型时标记为 Smoke Test。

若检查发现技术文档与现有代码冲突，代理只记录冲突并停止该阶段，不自行改变模块边界或公共契约。

## 子代理完成报告

每个代理完成后必须向主代理提交以下固定格式：

```text
修改文件
- <相对路径>

执行命令
- <命令>

测试结果
- <通过、失败或未执行，以及关键输出>

未解决风险
- <风险或“无”>

越界修改
- <文件路径和原因，或“无”>
```

主代理在接受报告前检查 `git diff --check`、所有文件是否仍在独占范围内，以及报告中的测试是否与当前工作区一致。报告缺少命令、结果或越界说明时，阶段不算完成。

## 主代理集成任务

主代理不把公共接线隐含在子代理任务中，必须显式完成以下工作：

1. 在 `app.module.ts` 注册 `UserMemoryModule`，并确认导出端口的依赖方向没有循环依赖。
2. 在 `mikro-orm.config.ts` 注册四个新实体，检查实体发现路径、迁移路径和测试配置。
3. 审查并创建单独的 MikroORM migration：设置表、记忆表、任务表、任务结果表、索引、部分唯一索引、检查约束、外键和 `down` 顺序。
4. 在 `llm.module.ts` 注册并导出结构化文本生成端口的实现，确认复用已有供应商配置、超时和错误分类。
5. 在 `chat-records` 中接入记忆读取、上下文注入、聊天事务内任务登记和来源会话删除标记；聊天模块只能依赖记忆模块公开端口。
6. 检查聊天 HTTP 响应不等待异步提取，且任务写入失败时沿用既有聊天事务错误语义。
7. 在前端路由注册懒加载的 `/memories` 页面，并在已有账户或应用导航中添加入口；不把页面局部状态放入全局 Store。
8. 检查 Axios 适配器、响应类型、错误映射和当前认证重试行为与现有 `src/api/` 约定一致。
9. 处理包脚本、环境示例、锁文件和格式化差异；新增配置必须同步 `.env.example`，不得写入真实凭据。
10. 集成后重新检查模块边界、中文注释、实体响应隔离、用户归属查询和日志脱敏。

## 按顺序排列的实施阶段

### 阶段 0：基线和依赖确认

**负责者：** 主代理。

**前置检查：**

- 实施文档已获用户明确确认。
- `git status --short` 已记录，已有改动未被覆盖。
- 已阅读当前 `users`、`chat-records`、`llm`、认证、MikroORM 配置和前端路由实现。
- 已确认当前工作区使用的 Zod 绑定、Axios、Vue 页面结构和测试命令。

**完成标准：**

- 形成不修改代码的基线记录。
- 确认数据库可用性、迁移命令、API typecheck/test/build 命令和前端构建命令。
- 明确本次实现不增加新基础设施依赖。

### 阶段 1：后端领域基础与 API 骨架

**负责者：** 后端领域代理。

**实施内容：**

- 创建 `apps/api/src/user-memory/` 目录及职责子目录。
- 创建四个 Entity，字段、关系、索引和软删除状态与技术文档一致。
- 创建类别值、候选结果和 API Body/Query/Param schema；对象默认使用 `z.strictObject`。
- 创建 DTO 输入/输出类型、响应 mapper、手动 CRUD、设置开关、用户读取端口和来源生命周期端口。
- 绑定 `StandardSchemaValidationPipe` 所需的 Controller schema 元数据。
- 对用户归属、资源不存在、越权、未知字段、默认值、转换和 `404/400` 行为补充中文注释和实现说明。

**前置检查：**

- 阶段 0 完成。
- 不创建迁移；实体只按已确认表结构编写。
- 不在 Controller 手写业务校验，不直接返回 Entity。

**完成标准：**

- 模块内部编译通过，Controller 只负责参数、当前用户、Service 调用和响应。
- 所有 API schema 都能区分 `z.input` 与 `z.output` 的需要，并覆盖严格字段和边界规则。
- 模块导出仅限 `UserMemoryReaderService`、`UserMemoryTaskService`、`UserMemoryLifecycleService` 所需公开能力。
- 代理报告通过主代理的文件所有权检查。

### 阶段 2：LLM 结构化文本生成端口

**负责者：** LLM 端口代理；主代理负责模块注册。

**实施内容：**

- 新增窄接口 `StructuredTextGenerationPort`，输入仅包含 system、user 和超时，输出只包含模型标识与文本。
- 复用现有 `ChatModelFactory` 的供应商配置和超时策略。
- 明确不绑定聊天工具、LangGraph trace、可见响应或长期聊天状态。
- 对供应商超时、空输出和不可用错误映射为任务处理器可识别的内部失败分类。

**前置检查：**

- 阶段 1 已定义候选 schema 和提取输入边界。
- 已阅读当前 LLM provider、fake model 和模块导出方式。

**完成标准：**

- 端口不暴露密钥、不记录完整 prompt 或原始模型响应。
- 端口类型可被 `UserMemoryExtractorService` 注入，且不反向依赖记忆模块。
- 主代理可以在不修改聊天图行为的情况下完成模块注册。

### 阶段 3：任务领取、提取和重试处理器

**负责者：** 任务处理代理；主代理负责实体注册和迁移接线。

**实施内容：**

- 实现聊天事务内的 `deduplicationKey` 登记。
- 实现 `pending/failed` 任务领取、`FOR UPDATE SKIP LOCKED`、`processing` 锁定和尝试次数。
- 实现结构化候选解析、`explicit` 检查、敏感过滤、数量限制、值规范化和 SHA-256 指纹。
- 实现候选结果唯一键、冲突规则、主要偏好锁定、软删除和事务边界。
- 实现 `1m/5m/30m` 退避（首次处理后最多重试三次）、processing 超时回收和 `onModuleDestroy` 清理轮询器。
- 失败只记录内部错误分类，不写入模型原文、聊天原文或完整记忆值。

**前置检查：**

- 阶段 1 和阶段 2 完成。
- 已确认任务表字段、索引、结果唯一键和设置关闭语义。
- 已确认进程内轮询器不能阻断聊天请求。

**完成标准：**

- 重复任务、重复候选、并发主要偏好更新和处理崩溃重试均保持幂等。
- 设置关闭时任务可以成功结束但不应用候选。
- 模型无效 JSON、超时、敏感候选和数据库瞬时错误都有明确状态或退避行为。
- 轮询器在模块销毁时停止，不遗留定时器。

### 阶段 4：聊天读取、注入和生命周期接线

**负责者：** 主代理。

**实施内容：**

- 在聊天模型调用前读取当前用户相关记忆，遵守“当前消息 > 长期记忆 > 系统默认规则”。
- 将最多 8 条、最多 512 token 的结构化摘要加入现有 `ChatContextService` 预算。
- 在 `ChatRecordsService.persistChat` 保存用户和助手消息的同一事务内登记提取任务。
- 在来源会话删除前调用生命周期端口，标记 `source_status=deleted`，再沿用现有聊天删除级联。
- 处理记忆模块导入、公开端口和 existing tracing/chat history 的依赖方向。

**前置检查：**

- 阶段 1 和阶段 3 完成，公开端口已经稳定。
- 已阅读现有聊天记录事务、上下文预算和会话删除实现。

**完成标准：**

- 聊天响应不等待模型提取任务。
- 记忆关闭时不读取、不注入、不产生新的提取应用。
- 聊天模块不访问记忆 Repository、Entity 或私有 DTO。
- 删除来源聊天后记忆保留且只显示来源已删除状态。

### 阶段 5：前端记忆管理页面

**负责者：** 前端代理；主代理负责路由和导航接线。

**实施内容：**

- 创建 `apps/web/src/pages/memories/index.vue`、`page.ts` 和页面私有 `components/`。
- 创建 `apps/web/src/api/modules/memories.ts` 和 `apps/web/src/api/types/memories.ts`。
- 实现列表加载、空数据、加载失败、提交中、提交失败、删除单条、删除全部确认、设置开关和结构化值编辑。
- 按类别展示 `single/multi/range` 值，隐藏内部任务、指纹、用户 ID 和模型字段。
- 使用现有 shadcn-vue 基础组件和图标，组件通过 typed Props/Emits 保持单向数据流。
- 所有请求走 Axios API 底座，不在页面中直接拼接 URL 或处理认证重试。

**前置检查：**

- 阶段 1 的最终响应类型和错误契约可用。
- 已阅读现有 `account`、`chat` 页面结构、路由 Guard、API 模块和 UI 组件。

**完成标准：**

- 页面满足 `idle/loading/success/empty/error` 和提交状态要求。
- 删除全部只发送 `confirm: true`，重复提交被阻止。
- 删除全部与提取任务并发时，已提交记忆会被软删除，未提交候选不会重新创建记忆。
- 页面卸载清理请求或过期响应保护，不产生旧请求覆盖新状态。
- 主代理可以在不改页面私有文件的情况下完成路由注册。

### 阶段 6：自动化测试和测试替身

**负责者：** 测试代理；主代理补充跨模块测试。

**实施内容：**

- 覆盖每个类别值 schema 的合法、边界、未知字段和非法组合。
- 覆盖 `z.input` 查询转换、默认 pageSize、Body/Query/Param 的 400 映射。
- 覆盖手动 CRUD、设置开关、用户隔离、越权 404、重复值幂等和软删除。
- 覆盖任务领取、退避、超时回收、候选解析、敏感过滤、重复结果和并发主要标记。
- 使用 Fake Structured Text Generation Port，不调用真实供应商。
- 主代理补充真实测试数据库迁移、模块注册、聊天链路和来源删除集成测试。

**前置检查：**

- 阶段 1 至阶段 5 的接口已稳定；测试代理不得为了通过测试改变生产契约。
- 已确认测试数据库、fixture、认证测试工具和现有 Jest/Vitest 配置。

**完成标准：**

- 新增测试放在 `apps/api/src/user-memory/spec/`，不创建跨业务全局 spec 目录。
- 测试能证明未知字段、非法值、权限边界和内部字段泄漏均符合契约。
- 测试失败时报告最小复现命令和失败原因，不以放宽断言解决实现问题。

### 阶段 7：主代理集成、迁移审查和仓库验证

**负责者：** 主代理。

**实施内容：**

- 完成模块、实体、LLM 端口、聊天、前端路由和导航的公共接线。
- 创建并审查迁移 SQL，确认外键、部分唯一索引、检查约束、`ON DELETE` 行为和 `down` 顺序。
- 检查 package scripts、环境示例、锁文件和格式化结果。
- 执行完整验证命令和真实数据库 Smoke Test。
- 汇总子代理报告，记录未解决风险、未实施的非目标和后续工作。

**完成标准：**

- 没有越界修改、循环依赖、直接返回 Entity、跨用户查询或敏感日志。
- 所有文档链接有效，实施结果与已确认技术文档一致。
- 只有完成本阶段后，才能把模块标记为已实现。

## 验收标准

### 业务和权限

- 登录用户可以查看、创建、修改、删除和删除全部自己的长期记忆。
- 游客无法创建或读取长期记忆；访问返回现有认证错误。
- 访问他人记忆 ID、伪造来源或越权删除统一返回 `404`，不泄露资源存在性。
- 管理员普通接口不能读取其他用户记忆原文。
- 关闭记忆停止读取、注入和提取应用，但不删除已有数据；重新开启后 active 记忆可继续使用。

### 数据和一致性

- 四张表、索引、检查约束、外键级联和来源会话 `ON DELETE SET NULL` 与技术文档一致。
- 记忆值只能通过类别判别联合 schema，不能写入任意画像 JSON。
- active 值指纹、任务去重键和候选结果键共同保证幂等。
- 主要偏好在事务和锁定范围内保持同类最多一条。
- 删除来源聊天保留记忆并标记来源已删除；账号物理删除具备级联清理能力。

### 聊天、模型和任务

- 当前消息优先于长期记忆，长期记忆优先于系统默认规则。
- 只注入相关记忆，最多 8 条且最多 512 token，不突破现有上下文 hard limit。
- 聊天 HTTP 响应不等待异步提取；任务失败、模型超时和无效 JSON 不影响已完成聊天。
- 轮询器支持多实例领取、退避、超时回收和模块销毁清理。
- 日志不包含密钥、Token、完整原文、模型原始响应、完整记忆值或候选推理。

### API、前端和验证

- Body、Query、Param 均由 Zod schema 和 `StandardSchemaValidationPipe` 校验；未知字段返回 `400`。
- 响应对象不包含 `userId`、指纹、任务字段、删除值或内部错误。
- 前端完整处理加载、空数据、错误、提交中和提交失败状态，且遵守页面目录、Axios、Props/Emits 和生命周期约定。
- 迁移 `up/down`、API typecheck、API test、API build、格式检查、`pnpm check` 和主要 Smoke Test 均有实际结果记录。

## 风险和停止条件

以下情况必须停止当前实施阶段，不得用临时改动绕过：

- 技术文档中的表结构、类别、API 路由、权限或删除语义与现有代码无法兼容。
- 需要新增 Redis、队列、向量数据库、Embedding、外部服务或新的认证体系。
- 发现需要修改 `chat_messages`、`chat_trace_events` 的公开语义才能实现记忆功能。
- 无法保证同一文件的独占所有权，或代理出现未报告的越界修改。
- 迁移无法安全创建、回滚或验证外键、部分唯一索引和历史数据兼容性。
- 无法确认用户归属、关闭设置、来源删除或账号删除的事务边界。
- 模型端口需要记录原始 prompt、原始响应、供应商凭据或完整聊天原文。
- 测试只能依赖真实生产服务、真实第三方密钥或不可控外网。
- `pnpm format:check`、API typecheck/test/build、`pnpm check` 或迁移验证失败，且无法定位为环境问题。

环境问题必须单独记录命令、错误和影响范围；不能把未执行或失败的验证写成通过。`migration:fresh` 只可在明确可销毁的本地或 CI 数据库执行，不作为普通功能验证。

## 实施交付记录

- 代码范围：长期记忆 API、结构化提取任务、聊天上下文接线、来源会话生命周期、管理页面和路由已实现。
- 数据库：`Migration20261103120000` 已应用到当前本地 PostgreSQL；通过 MikroORM 查询确认已执行。已审阅 `down()` SQL，但未在当前数据库执行回滚。
- API：`pnpm --filter @clothes-shopping-guide/api typecheck`、`test`、`build` 通过；测试共 75 项通过。
- Web：前端代理报告 `typecheck`、`build`、变更文件 Prettier 和 `git diff --check` 通过。
- 变更文件 Prettier 与 `git diff --check` 通过。
- 本地 HTTP/PostgreSQL Smoke Test 通过：认证、记忆列表、未知字段 400、创建、跨用户越权 404、开关、单条删除和删除全部；测试使用的临时账户已清理。
- 关闭记忆时不读取聊天原文、不调用提取模型的行为有自动化回归测试。未调用真实 LLM；真实模型提取、聊天后任务入队再到记忆应用的完整端到端 Smoke Test 仍待验证。
- `pnpm check` 在 `format:check` 阶段失败：格式检查仍报告生成的 MikroORM snapshot 和未修改的 `apps/api/src/llm/context/system-context.md`。未对生成 snapshot 或无关上下文文档做全文件重排。根级 `pnpm typecheck` 与 `pnpm build` 已分别通过。
