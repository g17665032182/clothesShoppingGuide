# 用户偏好与用户记忆完整拆分技术文档

## 状态与审批边界

- 状态：已确认，实施规划中。
- 最后更新：2026-11-04。
- 已确认：[完整拆分设计](./user-preference-memory-separation-design.md)、[偏好契约](../contracts/user-preferences-crud-contract.md)、[记忆契约](../contracts/user-memory-crud-contract.md)。
- 确认记录：2026-11-04 用户回复“确认”，批准本文技术方案。
- 当前阶段：实施规划；本文件中的目录、接口和 SQL 规则是实施目标，不是已经完成的改动。
- 下一阶段：仅编写 [拆分实施文档](./user-preference-memory-separation-implementation.md)；实施文档确认后才能修改代码、配置、测试和 Migration。
- 原 `user-memory-technical.md`、`user-memory-implementation.md` 仅记录历史混合方案，不作为本次实施依据。

## 技术目标与现有能力

本次将偏好与 Markdown 记忆拆成两个独立领域，分离设置、持久化、任务、提示、模型调用、候选和生命周期。聊天分别接入，基础设施继续复用。

| 能力        | 当前依赖或实现                                           | 决策                                      |
| ----------- | -------------------------------------------------------- | ----------------------------------------- |
| 模块与 HTTP | NestJS 12.2.0，现有全局 JWT、当前用户与标准校验 Pipe     | 复用，分别注册模块和 Controller           |
| 数据库      | MikroORM 7.2.5、Nest 集成 7.1.0、PostgreSQL              | 复用事务、fork、RequestContext、Migration |
| 校验        | Zod 4.6.7                                                | 各模块自有 schema；不新增校验库           |
| 模型        | `STRUCTURED_TEXT_GENERATION_PORT`                        | 两个独立调用方复用公共端口                |
| 对象存储    | qiniu 7.15.2，当前文档 Store/Cleanup                     | 只归记忆模块                              |
| 前端        | Vue、Axios、现有 shadcn-vue UI 和 MarkdownRenderer       | 拆 API/类型/状态，复用现有 UI             |
| 测试        | node:test、assert、tsx 与现有 PostgreSQL Smoke Test 模式 | 复用；不新增前端测试框架                  |
| 模块系统    | NodeNext、`type: module`                                 | 后端相对导入继续使用 `.js`                |

本地依赖足够，不增加 Redis、BullMQ、Embedding、第二套数据库连接或第二套认证体系。

### 官方资料核对

已核对 MikroORM v7.2.5 官方源码仓库中的 identity-map、usage-with-nestjs、transactions 和 migrations 文档，并检查本地安装包中的 RequestContext、EntityManager 和 TransactionPropagation 类型。

- Nest Modules：`https://docs.nestjs.com/modules`
- MikroORM v7.2.5 文档源码：`https://github.com/mikro-orm/mikro-orm/tree/v7.2.5/docs/docs`
- PostgreSQL 锁：`https://www.postgresql.org/docs/17/explicit-locking.html`
- Zod API：`https://zod.dev/api`

具体采用 `RequestContext.create()` 和显式 `em.transactional(..., { propagation: TransactionPropagation.NESTED })`，避免 v7 装饰器默认传播方式与方法默认传播方式不同造成误用。所有数据库调用使用当前上下文或明确传入的事务 EM。

## 包与目录

目标目录按职责设置，不为没有文件的职责建立空目录。

```text
apps/api/src/
  user-preferences/
    index.ts
    user-preferences.module.ts
    port/user-preferences.port.ts
    controller/user-preferences.controller.ts
    dto/{user-preference,preference-id,preference-settings}.dto.ts
    entity/{user-preference,user-preference-setting,user-preference-task,
            user-preference-task-result}.entity.ts
    entity/user-preference.mapper.ts
    service/{user-preferences,user-preference-settings,user-preference-reader,
             user-preference-lifecycle,user-preference-task,
             user-preference-extractor,user-preference-scheduler}.service.ts
    context/{preference-value,preference-candidate}.schema.ts
    context/{preference-context.formatter,preference-safety}.ts
    task/{preference-task-claim,preference-task-backoff}.ts
    spec/
  user-memory/
    index.ts
    user-memory.module.ts
    port/user-memory.port.ts
    controller/{user-memory-document,user-memory-settings}.controller.ts
    dto/{user-memory-document,memory-settings}.dto.ts
    entity/{user-memory-setting,user-memory-task,
            user-memory-document-state,user-memory-document-task-result,
            user-memory-document-cleanup}.entity.ts
    service/{user-memory-settings,user-memory-reader,user-memory-task,
             user-memory-extractor,user-memory-scheduler,
             user-memory-document,user-memory-document-store,
             user-memory-document-cleanup}.service.ts
    context/{memory-document,memory-document-patch,memory-candidate}.schema.ts
    context/memory-safety.ts
    task/{memory-task-claim,memory-task-backoff}.ts
    spec/
  chat-records/
    extraction-source/
      index.ts
      chat-extraction-source.module.ts
      chat-extraction-source.service.ts
      chat-extraction-source.port.ts
    ...
```

花括号仅压缩同目录文件名，不表示实际文件使用花括号命名。偏好 Entity、schema 和测试从旧记忆模块迁入并重命名；文档相关文件留在记忆模块。删除旧混合 Controller、结构化 `UserMemoryService` 和旧偏好实体注册，不能保留两个类映射同一张表。

### 共享代码的限制

- 不在 common 中放偏好类别、文档补丁、开关、任务或业务服务。
- 敏感文本的纯字符串检测可提取为 `common/security/sensitive-text.ts`，只接收文本并返回布尔值，既有规则保持不变。
- 偏好值中哪些字段需要检查由 preference-safety 负责；Markdown 整文和补丁校验由 memory-safety 负责。
- 两个领域不互相导入私有代码；不能为了去重创建通用领域任务框架。

## 公开入口与依赖注入

每个领域通过 `index.ts` 只导出 Nest Module、注入 token 和窄接口，不导出 Entity、Repository、Controller 或内部 DTO。

### 领域公开能力

| 能力         | 偏好公开入口                                  | 记忆公开入口                          |
| ------------ | --------------------------------------------- | ------------------------------------- |
| 读取上下文   | `readContext(userId, currentMessage)`         | `readContext(userId, currentMessage)` |
| 登记任务     | `enqueueInTransaction(em, input)`             | `enqueueInTransaction(em, input)`     |
| 来源会话通知 | `markConversationDeleted(em, conversationId)` | 不提供无实际用途的通知方法            |

两个端口的 input 在所属模块单独定义，字段均为 userId、conversationId、userMessageId、assistantMessageId；不传入另一个领域 Entity。EM 是数据库基础设施类型，不能借此操作对方表。

模块注册使用各自 provider/token，领域服务可直接实现对应窄接口，避免只做方法转发的多余 Facade。CRUD 和设置服务保持私有，由所属 Controller 调用。

### 聊天消息读取

当前提取器直接查询聊天表，需要改成聊天模块提供的只读能力：

- `ChatExtractionSourceModule` 只导入本领域消息/会话 Repository 及必要用户公开能力，导出 `CHAT_EXTRACTION_SOURCE`。
- `readTurn(input)` 返回 `{ userMessage, assistantMessage } | null`，不返回聊天 Entity、trace 或模型内部上下文。
- 校验用户有效、会话归属、消息归属和 user/assistant 角色。缺失或来源会话已删除时返回 null。
- Users 可补充返回布尔值的公开 `isActive(userId)`，不让提取模块依赖用户实体判断状态。
- 两类提取器导入这个聊天只读子模块；它不导入 ChatRecordsModule、偏好或记忆。
- ChatRecordsModule 再导入两个领域模块，因此依赖图为 ChatRecordsModule → 两个领域 → ChatExtractionSourceModule，无循环依赖，不使用 forwardRef 掩盖循环。
- 只读子模块使用自身 extraction-source/index.ts 作为公开入口，不从同时导出 ChatRecordsModule 的聚合入口导入，避免 barrel 文件造成运行时循环。
- 共享的是已经持久化的聊天事实，不是任务状态或提取逻辑；两类任务不复制完整聊天原文到自己的表。

## 数据模型与约束

### 用户偏好

| 表                             | 关键字段与约束                                                               |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `user_preferences`             | 原结构化记录字段；保留 UUID、JSON value、类别、来源、主偏好与删除状态        |
| `user_preference_settings`     | user_id 主键、enabled 默认 true、created_at、updated_at                      |
| `user_preference_tasks`        | 原任务基础字段；不含 document_generation；增加可空 candidate_operations JSON |
| `user_preference_task_results` | id、task_id、operation_key、action、preference_id、applied_at                |

- 保留 active 状态下 `(user_id, category, value_fingerprint)` 的部分唯一索引。
- 保留 user/status/updated、user/category/status 和来源索引，索引及约束改为偏好名称。
- 任务状态保持 pending/processing/succeeded/failed，attempts 非负；deduplication_key 唯一。
- `(task_id, operation_key)` 唯一，结果外键引用偏好任务，级联删除。
- 原 memory_id 列重命名为 preference_id，保留原值；不擅自为历史列新增原本不存在的外键。

### 用户记忆

- 记忆设置继续使用 user_memory_settings，但仅控制记忆。
- user_memory_tasks 保留 document_generation，增加可空 candidate_operations JSON。
- 文档状态、文档结果和对象清理表保持现有内容与关联。
- 记忆模块不再注册 user_memories 或 user_memory_task_results 对应实体。

### 候选缓存

两个任务表各自保存本领域通过完整 schema 和敏感过滤的 operations 数组，null 表示尚未成功生成，空数组表示有效的无更新结果。

- 不保存原始模型响应、分析、聊天全文、上传 token 或文档完整副本。
- 单轮最多 10 项，继续遵守各领域文本长度和总大小边界。
- 保存候选必须在本领域锁和有效任务租约检查之后，先持久化候选再应用。
- 重试复用已保存候选，不再次生成不同内容；应用时仍重新检查设置、任务、generation 和最新资源状态。
- 不做跨领域联合候选缓存，也不依赖另一任务是否成功。
- 成功、最终失败、租约对应任务取消或 generation 失效时清空候选缓存；仅保留仍需重试的任务候选，避免任务历史继续保存已清空正文片段或已删除偏好值。

这属于内部重试所需的任务字段，不增加对外 API。候选具有与长期资源相同的访问限制，不进入普通日志。

## 独立任务链路

### 登记与聊天事务

1. ChatRecordsService 继续先持久化会话和消息。
2. 在同一外层事务中，按偏好、记忆的固定顺序分别调用登记端口，不在同一个事务连接上并行执行。
3. 每次登记通过显式 NESTED 事务建立 savepoint，检查本领域设置并执行去重插入。
4. 记忆登记捕获 document_generation，偏好登记不访问文档状态。
5. 本领域可恢复错误先回滚 savepoint，再记录安全故障分类并继续另一领域；不能在 PostgreSQL 已报错但未回滚 savepoint 的连接上继续操作。
6. 外层事务失败时，两类已经登记的任务一并回滚，不留下引用未提交消息的任务。

不使用 REQUIRES_NEW 登记任务，否则独立连接看不到外层未提交消息，并可能破坏原子性。数据库整体断连仍会影响整个持久化事务，业务隔离不承诺消除共享基础设施故障。

单个登记失败时，不伪造该领域任务成功；日志明确记录登记失败，当前聊天消息仍可在外层数据库可用时提交。自动补偿扫描不在本次范围。

### 领取、上下文与租约

- 两个调度器各自轮询 1 秒、批次 10、处理超时 10 分钟；独立最大 4 次尝试，退避 1/5/30 分钟。
- 每个后台轮询入口通过 `RequestContext.create(orm.em, callback)` 建立新上下文；对象清理入口也需要独立上下文。
- 启动恢复与周期恢复均在有效上下文内执行，不使用根 EM 的全局 identity map。
- 领取使用各自表的 `FOR UPDATE SKIP LOCKED`，在短事务中更新 attempts 和 locked_at。
- 领取后的查询、候选保存、应用和状态更新使用上下文 EM 或明确 fork，不退回根 Repository。
- 每次领取以 `(taskId, attempts, lockedAt)` 作为执行租约；保存、应用、成功和失败更新都复查它。
- 超时恢复后旧 worker 的租约不再有效，不能提交旧结果或修改新 worker 的状态。
- 模型调用在数据库事务之外；领域应用时再开启短事务，七牛指针切换延续现有受锁协议。
- shutdown 停止领取、清理定时器，并等待已开始工作在模型超时等有界期限内退出；不在销毁后继续调度。

### 两类提取器

偏好提取：

- 只读取本轮消息，模型返回 `{ operations: [...] }`，最多 10 项。
- operation 为 upsert/delete，category/value 匹配，保留 explicit 和 isPrimary 规则。
- 过滤临时、推测和敏感内容；合并、主偏好和去重沿用现有规则。

记忆提取：

- 读取本轮消息和当前文档，模型独立返回 `{ operations: [...] }`。
- 每项为既有 append/replace/delete 补丁；explicit 必须 true。
- 不接受偏好类别/value，不接受全文覆盖字段。
- 文档存储不可用只使记忆任务失败，不阻止偏好提取。

两边都复用 StructuredTextGenerationPort，单次超时 30 秒，分别保存候选及操作结果。既有 operation_key 计算保持兼容，不能在迁移时改序列化/归一化方式导致旧键失效。

## 锁、设置和删除

### 锁归属与顺序

- 偏好使用 `user-preferences:<userId>` 事务级 advisory lock。
- 记忆沿用 `user-memory-document:<userId>`。
- CRUD、开关、任务登记和应用需要同用户串行化时使用本领域锁。
- 顺序统一为本领域 advisory lock → 当前任务行 → 设置/资源/结果行。
- 只有聊天登记依次接触两类锁，固定偏好在前、记忆在后；领域内部不得回调另一领域形成反向锁链。
- 模型生成期间不占用用户锁或数据库长事务。

### 设置

- 两边各有设置服务和 schema，默认 enabled true。
- 首次初始化在锁下执行幂等创建，避免 GET/list 并发创建唯一冲突。
- 提取开始及落库前复查本领域 enabled；人工管理不受关闭影响。
- GET 设置、偏好列表与 PATCH 的 response 分别使用本领域类型。

### 删除全部偏好

在偏好锁下：

1. 使该用户 pending/processing/failed 的偏好任务失效，删除任务行及其幂等结果或按既有清理语义取消。
2. 逻辑删除 active 偏好，记录 deleted_at，返回本次删除数量。
3. 在途 worker 应用时必须重新查任务及租约；任务不存在就跳过，不重新创建任务。

成功接口不接触记忆任务、文档状态或七牛对象；之后新聊天允许建立新偏好任务。

### 清空记忆

在记忆锁下递增 generation、清空对象指针，并安排旧对象回收。每个旧任务应用时重查 generation；即使空文档也不能让旧任务回写。偏好任务不读取 generation，因此不受影响。

## 历史数据迁移

### 前置条件

- 新增单独 Migration，不修改已经执行的旧 Migration。
- 升级采用维护窗口：停止新聊天写入，排空旧 worker，确认旧实例全部退出，再切换 schema 和应用。
- 七牛对象不重建，保留数据库与对象一致备份。
- 旧实现没有持久化模型候选，不能对“部分成功但仍可重试”的旧任务重新生成内容并宣称精确幂等。

因此 migration 前置检查必须拒绝以下旧任务：仍可运行、已经存在任一领域操作结果的 pending/failed/processing 任务。应先由旧版本将其处理至成功或最大次数的终态，再迁移。检查失败须使迁移回滚，不能删除结果、跳过任务或自动把它标为成功。

没有部分结果的 processing 任务在旧 worker 停止后可以恢复；已经终态的部分结果保留为审计与幂等历史，不自动重试。

### SQL 转换目标

在 Migration 事务中顺序执行：

1. 校验旧数据、前置任务状态与目标表不存在，记录必要计数，不打印正文。
2. 重命名 user_memories → user_preferences，保留数据、PK、来源及外键；重命名对应索引和约束。
3. 创建 user_preference_settings，从原 user_memory_settings 原值复制，并保留时间。原本没有设置的用户继续按默认 true 处理。
4. 创建 user_preference_tasks，复制旧任务共同字段，保留同一 UUID 作为本表任务 ID；不复制 document_generation。
5. 重命名 user_memory_task_results → user_preference_task_results，memory_id → preference_id；将 task_id 外键从记忆任务改为偏好任务，更新唯一索引及约束名称。
6. 现有 user_memory_tasks 留给记忆，文档结果关联保持。两类任务分别增加 candidate_operations，可空初始 null。
7. 将无在途 worker 的 processing 行规范化：attempts < 4 转 pending，available_at 不早于原值和迁移时间，locked_at 置空；attempts >= 4 转终态 failed。两类独立处理，不重置次数。
8. succeeded 保持 succeeded，failed 保留尝试次数及原可执行时间；已经达到上限的任务不自动复活。
9. 核对结果外键无悬空、记录 ID/值/来源/时间未丢失，两边结果各指向各自任务。

不同表中相同任务 UUID 是历史关联复制，不代表运行时共享任务；之后状态和重试独立更新。旧 operation_key 与文档结果保持原样。

### 验证与回滚

- 用旧 schema、已有用户、关闭开关、不同任务状态与两类结果的夹具验证转换。
- 单独覆盖部分成功且可重试的阻断情形，验证整个 Migration 回滚，无半改名表。
- schema 对比必须确认实际表、索引和 metadata 一致；清理旧构建产物，避免 dist 遗留实体被扫描为重复映射。
- 更新生成 snapshot 时只保留本次 schema 的必要差异，不混入无关格式修改。
- 不设计自动把两个已经独立变化的开关/任务合回一个值。`down()` 应明确拒绝未经恢复方案的数据合并，不能静默丢失任一边状态。
- 需要回退时停止新版本，使用维护窗口的一致数据库备份与七牛对象备份恢复，再启动旧版本；不要先回旧代码连接新 schema。

### 本地 fresh 与环境文件

- 按用户已确认的日常约定，本地重建使用 `pnpm migration:fresh`，自动执行 Seed，不改回 migration:up 作为日常命令。
- 迁移兼容性测试通过 Migrator 程序化应用到专用测试库，不在用户库做保留数据实验。
- 现有 ConfigModule 读取 .env.dev/.env，ORM CLI 当前仅导入 dotenv/config，可能得到不同配置。
- 实施时统一一个基础设施环境加载入口，按进程环境 > .env.dev > .env 的相同规则供 Nest 与 ORM/Seed 使用；不能把 shell source 和默认账号当作配置加载实现。
- 保持现有管理员 Seed 幂等，不重置已存在账号密码；增加测试确认 fresh 后管理员存在且密码匹配当前配置。
- 所有新示例只放占位值，不输出密码、连接串或真实七牛密钥。

## 请求 schema、类型和 HTTP 行为

请求 schema 放在所属模块 dto/；领域值、补丁及候选 schema 放 context/。文档正文基础校验可放 dto/ 相邻 schema 文件，避免请求模型归入另一个领域。

| 请求           | schema 所有者及建议名称                         | 规则与类型                                                                             |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| 偏好列表 Query | user-preferences/dto：listPreferenceQuerySchema | strict；page/pageSize coerce、默认 1/20，pageSize ≤ 100；可选 category                 |
| 创建偏好 Body  | createPreferenceSchema                          | 类别判别 union，嵌套 strict；isPrimary 默认 false                                      |
| 更新偏好 Body  | updatePreferenceSchema                          | strict；category/value/isPrimary 可选，至少一个变更字段                                |
| 偏好 ID Param  | preferenceIdParamSchema                         | UUID；在 @Param 绑定，不在 Service 重复校验字符串                                      |
| 删除全部 Body  | deleteAllPreferencesSchema                      | strict `{ confirm: literal(true) }`                                                    |
| 偏好设置 Body  | updatePreferenceSettingsSchema                  | strict `{ enabled: boolean }`                                                          |
| 文档更新 Body  | updateMemoryDocumentSchema                      | strict；content ≤ 32768 字节、合法 Unicode、无 NUL/敏感内容；expectedRevision 非负整数 |
| 记忆设置 Body  | updateMemorySettingsSchema                      | 独立 strict `{ enabled: boolean }`                                                     |

- 无 Body 的 GET/DELETE 文档接口不增加伪造 userId 或对象键输入。
- 分别使用 z.input/z.output 表达 Query 转换和创建默认值，普通类型可用 z.infer。
- 偏好局部更新依赖当前类别时仍需在领域中组合最终数据后运行同一个值 schema；这是状态相关校验，不复制规则。
- Controller 通过 @Body/@Query/@Param 的 schema 参数绑定全局 StandardSchemaValidationPipe。
- Swagger 请求/响应 DTO 分别维护，偏好和记忆使用不同 ApiTags；修复旧混合 Controller 的元数据引用。
- 未知字段、非法边界返回 400；未登录 401；偏好不存在或越权 404；重复偏好更新保留 400；文档冲突 409；存储不可用 503。
- 创建相同偏好保持复用语义；数据库唯一约束竞争仍走全局过滤器，覆盖对应冲突测试。
- GET/PATCH settings 静态路由优先，移除旧结构化 /memories 路由并测试其 404。

## 独立上下文与聊天预算

- 偏好读取器保留当前类别词项、active 筛选、主偏好排序、最大 100 行及最多 8 项。
- 记忆读取器只匹配当前文档相关段落，保留顺序，不匹配则返回空。
- 两边 readContext 使用各自 fork 的 EM，避免 HTTP 请求中并行读取时共享同一可变事务或 identity map。
- ChatRecordsService 使用 Promise.allSettled 分别读取，单边 rejected 转空并记录领域分类；不能以 Promise.all 的整体失败丢弃另一边。
- 各来源有界数据库/存储超时；不能仅用 Promise.race 放弃等待却留下无限运行的 I/O。
- ChatContextService 先将偏好分配至多 512 token，再把剩余预算给记忆；最终重新检查组合后的总 token，包含标题、分隔符和安全提示。
- 分隔符和提示也占预算，不能先把正文各自截到 512 再拼接。
- 有效来源单独存在时可使用可用总预算，关闭或失败一边不预留空额度。
- 不将任一来源内容视为系统指令，不对外返回内部来源数据。

## 前端必要适配

### API 与类型

- 新建 api/modules/preferences.ts、api/types/preferences.ts，承载 PreferenceRecord、PreferenceCategory、PreferenceValue、PreferenceSettings 和偏好分页/CRUD。
- api/modules/memories.ts、api/types/memories.ts 仅保留文档及 MemorySettings。
- 两类设置 GET/PATCH 各自封装，继续复用 Axios 底座及现有认证重试。
- 不保留旧 MemoryRecord 偏好别名；迁移所有选项、显示、表单、组件和 API 类型引用。

### 页面状态

- 保留现有 memories 页面与两个视图，不改导航组织。
- page.ts 只做视图组合，将偏好逻辑放 usePreferences 组合式文件，文档逻辑放 useMemoryDocument，状态不共享。
- 各视图只读取自己的 API 和设置，不在文档视图挂载时依赖偏好列表请求。
- 每个视图独立 idle/loading/success/empty/error 与 submitting/error 状态。
- 页面 header 根据 activeView 显示对应开关，事件调用对应设置；控件使用现有 UI 开关/checkbox 能力，不复制基础组件。
- 偏好列表携带 settings 的旧响应不能覆盖更新后的本地开关，使用请求版本或独立设置请求作为当前状态。
- 设置失败保留前值并允许重试，不能使用 enabled=true 的临时默认值假装已经读取成功。
- 保留 KeepAlive 草稿；deactivated 与 unmounted 的请求和订阅分别处理，旧响应不能污染另一视图或重新激活的状态。
- 卸载清理 AbortController、监听器和定时器；独立防重复提交。
- 文档 409 保留草稿，原始编辑、sanitize 预览及清空确认继续工作。

不安装 Vitest、Vue Test Utils 或 Playwright，不新增前端测试脚本。现有 typecheck/build 和条件允许的浏览器验证作为本次前端交付证据。

## 安全和可观测性

- 继续复用全局认证授权，不新增 Guard 或暴露跨用户资源入口。
- 两个日志 context、taskId 和领域分类明确区分；保留名称、经过允许的错误码和必要时间。
- 不直接记录 Error.message/stack、SQL、候选、文档、聊天正文、签名 URL 或未知异常对象，避免底层错误包含敏感数据。
- 两个调度器独立节流，持续故障最多每 30 秒一条；成功后清除故障状态，新的故障可立即记录。
- 区分模型超时、非法输出、存储故障、数据库可重试与租约失效，不能把所有异常都记为 DATABASE_RETRYABLE。
- 对象清理继续独立于两类提取，并在配置不可用时报告安全故障分类。
- 关闭功能只影响本领域提取和注入，不改变已有数据授权范围。

## 测试与验收证据

### 单元、schema 与 HTTP

- 分别覆盖各类别值、主偏好、多值合并、指纹和来源；文档字节/Unicode/敏感限制和 revision。
- 直接 Pipe 测试外，还须通过真实 Nest 路由验证绑定生效、400/401/404/409/503 和未知字段行为；旧名为 http.spec 的现有测试只直接调用 Pipe，不能当作完整 HTTP 覆盖。
- 四种开关组合，关闭不删除、不禁止手动管理。
- 双向越权、资源不存在、唯一约束和公开响应无内部字段。
- 两个提取 schema 互相拒绝对方字段，独立模型调用及错误分类。

### 任务与真实 PostgreSQL

- 无 HTTP 请求时初始化调度器，验证 RequestContext 及 fork 查询不会触发全局 EM 校验错误。
- 两个 worker 竞争领取无重复；租约过期后旧 worker 不能完成或提交。
- 候选保存后重试不再次调用模型，部分应用继续幂等。
- 关闭/清空/全部删除与在途生成并发，只隔离所属领域。
- 注入单个登记 SQL 错误，验证 savepoint 回滚后另一任务和聊天仍可提交；外层事务失败时不留下任一任务。
- 记忆对象存储或模型失败，偏好可完成；偏好失败，文档可完成。
- 两个 reader 一边失败时另一边保留，最终上下文 ≤ 512 token。

### Migration 与 Seed

- 旧表夹具含开启/关闭/无设置用户、成功/失败/处理中任务及两类结果。
- 验证 ID、状态、时间、外键、文档 generation 和唯一索引。
- 覆盖旧部分成功可重试任务的中止及事务回滚，不能仅验证空库 fresh。
- 专用可销毁测试库完成旧 schema → 新 schema 的程序化升级及结构对比。
- 本地 fresh 完成全链路建表和 Seed，账号配置来源一致；不打印密码。
- 不通过自动 down 合并独立状态，验证其明确拒绝行为。

### 前端与边界

- API/Web typecheck/build，检查偏好类型不再来自 memories。
- 静态边界检查：两类模块互相不 import、提取器不查聊天私有表、旧实体不存在重复发现。
- 浏览器核对双视图各自开关、加载失败、关闭管理、保存冲突、独立清空和草稿保留。
- 自动化使用 fake 模型和七牛；真实凭据验证单列为 Smoke Test，不把未执行项写成通过。

## 验证命令

实施批准后执行：

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

数据库类测试需显式指向专用测试库；本地重建仅在实施阶段执行 `pnpm migration:fresh`。当前实施规划阶段只运行文档格式和差异检查。

## 技术决策与剩余限制

1. 独立提取可能增加模型调用，复用客户端不会将两类任务重新耦合。
2. 旧部分成功且可重试任务必须先排空，Migration 遇到它们会中止。
3. 两类状态发布后不能无损自动合回旧单开关/单任务，回退依赖一致备份。
4. 独立任务共享数据库与模型服务，无法保证共享基础设施整体故障时任一业务仍可写入。
5. 实施阶段应按新文档分配文件所有权；本文件不代替后续实施计划，也不启动子代理开发。
