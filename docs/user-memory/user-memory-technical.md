# 用户长期记忆技术文档

## 状态与审批边界

- 状态：已确认，进入实施
- 上一阶段：用户长期记忆设计文档和 CRUD 契约已确认
- 当前阶段：实施中
- 下一阶段：按已确认的实施文档完成实现和验证
- 实施限制：实现必须遵守已确认的技术和实施文档，不得擅自改变数据、权限或 API 契约
- 最后更新：2026-11-03

本文将产品决策转换为可实施的技术边界。文档中出现的目录、类名和配置名是实施约定，不代表功能已经存在。

## 1. 技术目标与已确定选择

### 1.1 技术目标

1. 为登录用户提供跨会话、按服装问题相关性筛选的结构化长期记忆。
2. 让聊天读取、静默提取、人工管理和账号生命周期清理通过清晰的模块接口协作。
3. 使模型失败、任务重试、重复投递和多实例部署不会阻断聊天或制造重复记忆。
4. 让 API 输入、数据库约束、权限和日志行为可以被自动化验证。

### 1.2 本阶段确定的实现选择

| 领域         | 技术选择                                                        | 选择原因                                                     |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------------ |
| 业务模块     | `apps/api/src/user-memory/` 独立 Nest 模块                      | 与聊天记录、LLM 和用户模块保持职责边界                       |
| 持久化       | PostgreSQL + MikroORM 7.2.5                                     | 仓库现有数据库和事务能力                                     |
| 记忆值       | `jsonb` 保存受 Zod 判别联合约束的结构化对象                     | 允许类别有不同字段，同时拒绝任意画像 JSON                    |
| 任务载体     | 数据库任务表 + 进程内轮询处理器                                 | 当前没有 Bull/BullMQ；数据库任务可恢复、可观测、可多实例领取 |
| 任务领取     | PostgreSQL `FOR UPDATE SKIP LOCKED`                             | 避免多个 API 实例重复处理同一任务                            |
| 提取模型     | 复用当前 LLM 供应商配置，增加只返回结构化候选的内部文本生成端口 | 不重复建立凭据配置，不把聊天工具调用混入提取                 |
| 相关记忆选择 | 类别和关键词规则排序，不使用 Embedding 或向量数据库             | 第一版范围明确，依赖中没有向量存储能力                       |
| 幂等         | 任务唯一键、候选结果唯一键、值指纹和事务内锁定                  | 覆盖重复投递、处理崩溃后的重试和并发更新                     |
| 删除语义     | 记忆删除采用软删除字段；删除全部保留最小审计状态但不再参与查询  | 支持幂等重试和内部审计，不向普通 API 暴露已删除值            |
| 来源会话     | 会话删除前标记来源，外键使用 `ON DELETE SET NULL`               | 保留“原聊天已删除”状态，不复制聊天正文                       |

### 1.3 明确不采用的方案

- 不使用 LangGraph checkpointer 作为用户记忆存储。checkpointer 负责图运行状态，无法替代用户资源的权限、CRUD 和生命周期。
- 不把 `chat_messages`、`chat_trace_events` 或会话摘要扩展成长期记忆表。
- 不增加 Redis、外部消息队列、向量数据库或 Embedding 服务依赖。
- 不让客户端提交 `userId`、来源会话、任务状态、指纹、时间戳或模型候选理由。

## 2. 依赖与官方文档

### 2.1 仓库已安装依赖

| 依赖                                        | 当前版本 | 在本模块中的用途                               |
| ------------------------------------------- | -------- | ---------------------------------------------- |
| `@nestjs/common`                            | `12.2.0` | Module、Controller、Pipe、生命周期和 HTTP 异常 |
| `@mikro-orm/core` / `@mikro-orm/postgresql` | `7.2.5`  | Entity、Repository、事务和 PostgreSQL 查询     |
| `@mikro-orm/migrations`                     | `7.2.5`  | 记忆表、任务表和索引迁移                       |
| `zod`                                       | `4.6.7`  | Body、Query、Param 和内部模型输出校验          |
| `@langchain/core`                           | `1.3.0`  | 内部结构化文本生成端口和消息类型               |
| `@langchain/langgraph`                      | `1.5.2`  | 保持现有聊天图，不把记忆任务塞入聊天图         |
| `nestjs-pino`                               | `5.3.1`  | 任务状态和失败分类日志                         |

### 2.2 使用的官方文档

- NestJS Standard Schema：<https://docs.nestjs.com/pipes>
- NestJS 模块和生命周期：<https://docs.nestjs.com/modules>、<https://docs.nestjs.com/fundamentals/lifecycle-events>
- MikroORM 事务：<https://mikro-orm.io/docs/transactions>
- MikroORM 索引和唯一约束：<https://mikro-orm.io/docs/indexes>
- MikroORM Migration：<https://mikro-orm.io/docs/migrations>
- Zod 对象、判别联合和转换：<https://zod.dev/api>
- LangGraph StateGraph / ToolNode：<https://langchain-ai.github.io/langgraphjs/>

Nest 12 的 `StandardSchemaValidationPipe` 会读取参数元数据中的 schema；校验失败映射为 `400`，开启转换时使用 schema 的输出值。MikroORM 的 `em.transactional()` 会在回调失败时回滚，并在提交前 flush；记忆更新、主要偏好切换和任务结果记录必须使用这一边界。

## 3. 包和目录结构

### 3.1 后端模块

```text
apps/api/src/user-memory/
├── user-memory.module.ts
├── controller/
│   └── user-memory.controller.ts
├── service/
│   ├── user-memory.service.ts
│   ├── user-memory-reader.service.ts
│   ├── user-memory-task.service.ts
│   ├── user-memory-extractor.service.ts
│   ├── user-memory-scheduler.service.ts
│   └── user-memory-lifecycle.service.ts
├── entity/
│   ├── user-memory.entity.ts
│   ├── user-memory-setting.entity.ts
│   ├── user-memory-task.entity.ts
│   └── user-memory-task-result.entity.ts
├── dto/
│   ├── user-memory-query.dto.ts
│   ├── create-user-memory.dto.ts
│   ├── update-user-memory.dto.ts
│   ├── update-user-memory-settings.dto.ts
│   ├── delete-all-user-memory.dto.ts
│   └── user-memory-param.dto.ts
├── context/
│   ├── memory-value.schema.ts
│   ├── memory-candidate.schema.ts
│   └── memory-context.formatter.ts
├── task/
│   ├── memory-task-claim.ts
│   └── memory-task-backoff.ts
└── spec/
    ├── memory-value.schema.spec.ts
    ├── user-memory.service.spec.ts
    ├── user-memory-task.service.spec.ts
    └── user-memory.http.spec.ts
```

`context/` 只放记忆值、模型候选和上下文格式化；`task/` 只放任务领取和退避规则。业务模块根目录不建立跨模块共享 Entity 或 spec 目录。

### 3.2 允许的跨模块公开入口

`UserMemoryModule` 只导出以下端口：

- `UserMemoryReaderService`：聊天模块读取受限的相关上下文。
- `UserMemoryTaskService`：聊天模块在聊天消息事务中登记提取任务。
- `UserMemoryLifecycleService`：用户删除和来源会话删除时执行清理或状态更新。

聊天模块不得注入记忆 Repository、Entity 或内部 DTO。记忆模块不得引用聊天模块的私有实现。

## 4. 领域模型与结构化值

### 4.1 类别枚举

第一版使用以下稳定枚举，数据库和 Zod 使用相同字符串值：

```text
size
shoe_size
fit
style
color
occasion
budget
avoidance
purchase_preference
```

### 4.2 值结构

所有值必须是严格对象，禁止把完整聊天原文放入 `value`。以下是实现阶段需要落地的 schema 形状：

| 类别                  | `value` 结构                                                                                                                       | `valueType` |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `size`                | `{ garment: top \| bottom \| dress \| outerwear \| unknown, label: string(1..32), system?: CN \| US \| EU \| UK \| INT \| OTHER }` | `single`    |
| `shoe_size`           | `{ value: number(20..60), system: CN \| US \| EU \| UK, width?: narrow \| regular \| wide }`                                       | `single`    |
| `fit`                 | `{ preference: loose \| regular \| slim, notes?: string(0..80) }`                                                                  | `single`    |
| `style`               | `{ items: enum[] (1..5) }`，枚举包括 `minimal`、`commute`、`street`、`casual`、`formal`、`sporty`、`vintage`、`outdoor`、`other`   | `multi`     |
| `color`               | `{ mode: prefer \| avoid, items: string[] (1..8, 每项 1..32 字符) }`                                                               | `multi`     |
| `occasion`            | `{ items: enum[] (1..5) }`，枚举包括 `commute`、`casual`、`formal`、`outdoor`、`travel`、`sport`、`home`、`party`、`other`         | `multi`     |
| `budget`              | `{ currency: CNY \| USD, min?: integer, max?: integer }`，至少一个边界，`min <= max`                                               | `range`     |
| `avoidance`           | `{ terms: string[] (1..8, 每项 1..32 字符), reason?: string(0..80) }`                                                              | `multi`     |
| `purchase_preference` | `{ items: enum[] (1..6) }`，枚举包括 `quality`、`price`、`easy_care`、`sustainable`、`online`、`offline`、`durable`、`other`       | `multi`     |

`avoidance.reason` 仅用于解释服装购买偏好，不接受健康、身份、财务账户或其他敏感画像。自由文本项必须经过控制字符、凭据模式和敏感类别过滤。

### 4.3 冲突规则

- 同一用户、同一类别、同一值指纹的 active 记忆只保留一条。
- `size`、`shoe_size`、`fit` 和 `budget` 的新明确长期值默认覆盖同类别旧的 `isPrimary=true` 值；旧值保留为非主要值，除非用户明确删除。
- `style`、`color`、`occasion`、`avoidance` 和 `purchase_preference` 默认合并去重；明确“不要/忘记”操作删除匹配值。
- 每个类别最多一条 `isPrimary=true`。更新主要偏好时，在同一事务中先清除同类其他主要标记。
- 临时表达只作为本轮上下文，不产生候选写入。

## 5. PostgreSQL 数据模型

### 5.1 `user_memory_settings`

| 列           | 类型          | 约束                                       |
| ------------ | ------------- | ------------------------------------------ |
| `user_id`    | `uuid`        | 主键；外键 `users.id`，`ON DELETE CASCADE` |
| `enabled`    | `boolean`     | 非空，默认 `true`                          |
| `created_at` | `timestamptz` | 非空                                       |
| `updated_at` | `timestamptz` | 非空                                       |

每个用户最多一条设置。不存在时由读取或首次写入使用默认启用状态，并在需要持久化时创建。

### 5.2 `user_memories`

| 列                       | 类型           | 约束和用途                                               |
| ------------------------ | -------------- | -------------------------------------------------------- |
| `id`                     | `uuid`         | 主键，服务端生成                                         |
| `user_id`                | `uuid`         | 外键 `users.id`，`ON DELETE CASCADE`                     |
| `category`               | `text`         | `CHECK` 为第一版类别枚举                                 |
| `value_type`             | `text`         | `CHECK` 为 `single`、`multi`、`range`                    |
| `value`                  | `jsonb`        | 经过类别 schema 校验的结构化值                           |
| `value_fingerprint`      | `varchar(128)` | 服务端对规范化 JSON 做 SHA-256，禁止客户端提交           |
| `is_primary`             | `boolean`      | 非空，默认 `false`                                       |
| `status`                 | `text`         | `active` 或 `deleted`，默认 `active`                     |
| `source_conversation_id` | `uuid`         | 可空；外键 `chat_conversations.id`，`ON DELETE SET NULL` |
| `source_status`          | `text`         | 可空；有来源时为 `active`、`deleted` 或 `unavailable`    |
| `deleted_at`             | `timestamptz`  | 软删除时间，可空                                         |
| `created_at`             | `timestamptz`  | 非空                                                     |
| `updated_at`             | `timestamptz`  | 非空                                                     |

来源为空表示手动创建或无法关联到会话；来源为空时 API 映射为 `source: null`，不把内部 UUID 暴露为无效链接。

索引和约束：

- `user_memories_user_status_updated_index (user_id, status, updated_at desc)`：用户列表和相关上下文读取。
- `user_memories_user_category_index (user_id, category, status)`：类别筛选和冲突处理。
- `user_memories_source_conversation_index (source_conversation_id)`：会话删除时批量标记来源。
- 部分唯一索引 `user_memories_user_category_fingerprint_active_unique (user_id, category, value_fingerprint) WHERE status = 'active'`：防止重复 active 值。
- `CHECK (source_conversation_id IS NULL OR source_status IS NOT NULL)`。

### 5.3 `user_memory_tasks`

| 列                         | 类型           | 约束和用途                                               |
| -------------------------- | -------------- | -------------------------------------------------------- |
| `id`                       | `uuid`         | 主键                                                     |
| `user_id`                  | `uuid`         | 外键 `users.id`，`ON DELETE CASCADE`                     |
| `conversation_id`          | `uuid`         | 可空；外键 `chat_conversations.id`，`ON DELETE SET NULL` |
| `user_message_id`          | `uuid`         | 可空的来源消息 ID；不复制正文                            |
| `assistant_message_id`     | `uuid`         | 可空的来源消息 ID；不复制正文                            |
| `deduplication_key`        | `varchar(180)` | 非空、唯一，格式为 `conversationId:userMessageId`        |
| `status`                   | `text`         | `pending`、`processing`、`succeeded`、`failed`           |
| `attempts`                 | `integer`      | 非负，默认 `0`                                           |
| `available_at`             | `timestamptz`  | 下一次可领取时间                                         |
| `locked_at`                | `timestamptz`  | 领取时间，可空                                           |
| `last_error_code`          | `varchar(80)`  | 内部失败分类，可空                                       |
| `created_at`、`updated_at` | `timestamptz`  | 非空                                                     |

索引：

- 唯一索引 `user_memory_tasks_deduplication_key_unique (deduplication_key)`。
- `user_memory_tasks_claim_index (status, available_at, created_at)`。
- `user_memory_tasks_user_index (user_id, created_at desc)`，仅供内部运维，不提供普通用户接口。

任务不保存原始聊天文本。处理器通过消息 ID 读取当前用户自己的消息；来源已经删除时任务标记为不可处理并不产生记忆。

### 5.4 `user_memory_task_results`

| 列              | 类型           | 约束和用途                                       |
| --------------- | -------------- | ------------------------------------------------ |
| `id`            | `uuid`         | 主键                                             |
| `task_id`       | `uuid`         | 外键 `user_memory_tasks.id`，`ON DELETE CASCADE` |
| `operation_key` | `varchar(180)` | 同一任务内唯一的候选操作指纹                     |
| `action`        | `text`         | `upsert` 或 `delete`                             |
| `memory_id`     | `uuid`         | 可空；实际应用的记忆                             |
| `applied_at`    | `timestamptz`  | 非空                                             |

唯一索引 `user_memory_task_results_task_operation_unique (task_id, operation_key)`。处理器在应用候选和写入结果表时使用同一事务；任务在写入结果后崩溃并重试时，唯一键使操作安全跳过。

### 5.5 迁移策略

1. 技术文档确认后创建单独的 MikroORM migration，先建设置表、记忆表、任务表和结果表，再创建索引、检查约束和外键。
2. 不修改现有 `chat_messages` 或 `chat_trace_events` 的字段语义。
3. 迁移必须提供 `down`，删除顺序为结果表、任务表、记忆表、设置表。
4. 迁移前检查现有 `users` 和 `chat_conversations` 外键；迁移后使用 `migration:up` 和真实 PostgreSQL 验证索引及级联行为。
5. 账号当前只有逻辑禁用，没有物理删除流程。未来新增账号删除时，删除 `users` 行即可依靠外键级联删除设置、记忆、任务和任务结果；服务层仍需在事务中撤销会话并记录脱敏审计。

## 6. 模块边界与依赖方向

### 6.1 `UserMemoryModule`

- `UserMemoryController`：只处理 HTTP 参数、当前用户和响应映射。
- `UserMemoryService`：手动 CRUD、设置开关、冲突规则和软删除。
- `UserMemoryReaderService`：读取 active 记忆、相关性排序和上下文长度限制。
- `UserMemoryTaskService`：在聊天事务中登记任务、领取任务、记录任务状态。
- `UserMemoryExtractorService`：调用内部结构化文本生成端口、校验候选并过滤敏感内容。
- `UserMemorySchedulerService`：模块初始化后轮询待处理任务，关闭时停止定时器。
- `UserMemoryLifecycleService`：来源会话删除标记、账号删除清理。

### 6.2 依赖图

```text
Auth/JWT ───────> UserMemoryController
Users ──────────> UserMemoryModule
Llm public port ─> UserMemoryExtractorService
ChatRecordsModule ─> UserMemoryModule（只通过公开任务和生命周期端口调用）
```

为避免循环依赖，`UserMemoryModule` 不导入 `ChatRecordsModule`，只接收聊天模块传入的会话和消息 ID；`ChatRecordsModule` 导入 `UserMemoryModule`，调用其公开端口。

### 6.3 LLM 端口

技术实施时在 `llm` 模块导出窄接口，例如：

```ts
export type StructuredTextGenerationPort = {
  generate(input: {
    system: string;
    user: string;
    timeoutMs: number;
  }): Promise<{ model: string; content: string }>;
};
```

该端口复用 `ChatModelFactory` 的供应商配置和超时配置，但不复用聊天图的工具绑定、trace 写入或用户可见响应。原始模型响应、API Key 和完整提示词不得写入日志。

## 7. API 与 Zod Schema

全局 `StandardSchemaValidationPipe` 已在 `apps/api/src/main.ts` 注册。所有下列 schema 放在 `apps/api/src/user-memory/dto/`，Controller 通过 `@Body({ schema })`、`@Query({ schema })` 和 `@Param('id', { schema })` 绑定。schema 输出类型用于 Service 入参，Swagger DTO 只负责文档元数据。

### 7.1 公共值 schema

`memoryValueByCategorySchema` 是 `z.discriminatedUnion('category', variants)`：

- 每个 variant 使用 `z.strictObject`。
- 字符串先 `trim()` 再执行长度约束。
- 数字使用 `z.coerce.number().int()` 仅用于 Query；Body 中的鞋码和预算拒绝字符串数字，避免客户端类型不一致。
- `budget` 使用 `superRefine` 校验至少一个边界且 `min <= max`。
- `style`、`occasion` 和 `purchase_preference` 使用固定枚举数组；`color` 和 `avoidance.terms` 只允许经过长度和敏感过滤的短词。

### 7.2 `GET /api/memories`

Query schema：

```ts
const listMemoryQuerySchema = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    category: memoryCategorySchema.optional(),
  })
  .transform(({ page, pageSize, category }) =>
    Object.assign(new ListMemoryQueryDto(), { page, pageSize, category }),
  );
```

- `z.input<typeof listMemoryQuerySchema>` 接受 URL 查询字符串。
- `z.output<typeof listMemoryQuerySchema>` 为数字页码和默认页大小的 DTO。
- 未知参数、非法页码和非法类别经 `StandardSchemaValidationPipe` 返回 `400`。
- 只返回当前用户的 active 记忆；设置状态一并返回。

响应：

```ts
{
  items: MemoryResponse[];
  settings: { enabled: boolean; updatedAt: string };
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

### 7.3 `POST /api/memories`

Body schema 为带 `isPrimary` 默认值的类别判别联合：

实现时为每个类别 variant 使用 `z.strictObject` 扩展 `isPrimary: z.boolean().default(false)`，再组成判别联合；不要用普通 `and` 包裹整个判别联合，以免错误路径和输出类型不清晰。

- `z.input` 中 `isPrimary` 可缺省；`z.output` 一定是 boolean。
- `userId`、来源会话、状态、指纹、时间和 `valueType` 由服务端生成。
- 未知字段、类别和值不匹配返回 `400`。
- 如果 active 值指纹已存在，返回现有资源的幂等结果，不创建重复行。
- 成功响应 `201`，返回 `MemoryResponse`。

### 7.4 `PATCH /api/memories/:id`

Param schema：

```ts
const memoryIdParamSchema = z.uuid();
```

Body schema：

```ts
const updateMemorySchema = z
  .strictObject({
    category: memoryCategorySchema.optional(),
    value: z.unknown().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine(
    ({ category, value, isPrimary }) =>
      category !== undefined || value !== undefined || isPrimary !== undefined,
    '至少提供一个可更新字段',
  );
```

`value` 在 Zod 第一层只允许 `unknown`，随后 Service 读取现有类别，将合并后的 `{ category, value }` 交给 `memoryValueByCategorySchema` 重新解析；这样可以同时支持只改 `isPrimary` 和类别变更。非法组合、未知字段和空更新均返回 `400`。资源不存在或不属于当前用户统一返回 `404`。

### 7.5 `DELETE /api/memories/:id`

- Param 使用 `memoryIdParamSchema`。
- 不接收 Body。
- 成功返回 `204`；重复删除已删除资源仍按当前用户资源不存在处理并返回 `404`。

### 7.6 `DELETE /api/memories`

为避免误调用，要求显式确认：

```ts
const deleteAllMemorySchema = z.strictObject({
  confirm: z.literal(true),
});
```

- `confirm` 缺失、为 `false` 或存在未知字段返回 `400`。
- 服务在一个事务中取消当前用户的 pending、processing 和 failed 提取任务，再把所有 active 记忆更新为 deleted 并写入 `deleted_at`。
- 候选应用事务先对任务行加写锁并确认任务仍处于 processing。删除全部先删除未完成任务再软删除记忆，确保并发处理中已提交的记忆也会被删除，未开始应用的候选不会复活。
- 成功返回：

```ts
{
  deletedCount: number;
}
```

### 7.7 `PATCH /api/memories/settings`

```ts
const updateMemorySettingsSchema = z.strictObject({
  enabled: z.boolean(),
});
```

未知字段返回 `400`。关闭只停止读取和新任务的提取，不删除已有记忆；重新开启后 active 记忆可以继续注入。

### 7.8 响应映射

Service 使用显式 mapper 生成 `MemoryResponse`：

```ts
{
  id: string;
  category: MemoryCategory;
  valueType: 'single' | 'multi' | 'range';
  value: MemoryValue;
  isPrimary: boolean;
  source: null | {
    conversationId: string | null;
    status: 'active' | 'deleted' | 'unavailable';
  };
  createdAt: string;
  updatedAt: string;
}
```

不直接返回 Entity，不返回 `userId`、任务字段、指纹、删除值、模型候选理由或内部错误。

## 8. 聊天读取、注入与提取流程

### 8.1 读取与注入

```text
HTTP 聊天请求
  -> JWT Guard 和会话归属校验
  -> UserMemoryReaderService 读取当前用户设置
  -> enabled=false 时返回空上下文
  -> 按当前 user 消息进行类别/关键词相关性排序
  -> 取最多 8 条、最多 512 token 的结构化摘要
  -> ChatContextService 将摘要放入服务端 system context
  -> LLM/LangGraph 完成本轮回复
```

读取器只接收 `userId` 和当前消息文本，不接受客户端传入的其他用户 ID。没有明显相关类别时不注入全部画像；最多保留主要偏好、最近更新和与当前问题匹配的值。

记忆上下文使用明确分隔块，例如：

```text
[用户长期服装偏好，仅用于本次服装导购]
- 尺码：上装 L，偏好宽松
- 颜色：避免荧光色
[规则]
- 当前用户消息中的明确要求优先于以上记忆。
- 不要向用户展示内部记忆字段或来源 ID。
```

聊天模块仍由 `ChatContextService` 负责 token 预算。记忆块计入现有上下文预算，超限时按相关性从低到高移除；不能为了注入记忆突破 hard limit。

### 8.2 聊天成功后的任务登记

`ChatRecordsService.persistChat` 在保存 user/assistant 消息的同一 `em.transactional()` 中调用 `UserMemoryTaskService.enqueueInTransaction()`：

1. 写入会话和两条可见消息。
2. 生成 `deduplicationKey = conversationId:userMessageId`。
3. 插入 `pending` 任务；唯一冲突视为重复投递并复用已有任务。
4. 提交事务后立即返回聊天响应。

任务写入失败会让本次聊天事务失败并遵循现有聊天错误处理；模型提取失败发生在之后，不影响已经完成的聊天 HTTP 响应。若需要完全隔离任务表故障，应在后续阶段增加 outbox，但本技术版本先保证同事务可追踪。

### 8.3 任务领取与重试

轮询器每 1 秒尝试领取最多 10 条任务：

1. 在短事务中选择 `pending` 或可重试的 `failed` 任务，条件为 `available_at <= now()`。
2. 使用 `FOR UPDATE SKIP LOCKED`，更新为 `processing`、递增 `attempts` 并写入 `locked_at`。
3. 事务提交后执行模型调用，避免长事务占用数据库锁。
4. 成功时在另一个事务中应用候选、写入 `user_memory_task_results` 并将任务标记 `succeeded`。
5. 首次处理失败后最多重试 3 次，依次按 `1m、5m、30m` 退避；总处理次数最多 4 次。达到上限后标记 `failed`，只记录错误分类。
6. 进程崩溃后，启动时将超过 10 分钟仍为 `processing` 的任务重新置为 `pending`。

`UserMemorySchedulerService` 在 `onModuleDestroy` 中清理定时器；它不是新的队列基础设施，也不在 Controller 请求中同步等待。

### 8.4 提取和候选处理

提取输入只包含当前用户的 user 消息、对应 assistant 回复和必要的近期上下文；不把整段历史或内部 trace 传给模型。模型必须返回严格 JSON：

```ts
{
  operations: Array<{
    operation: 'upsert' | 'delete';
    category: MemoryCategory;
    value: MemoryValue;
    isPrimary?: boolean;
    explicit: boolean;
  }>;
}
```

处理顺序：

1. 用 `memoryCandidateSchema` 解析模型文本；解析失败不写记忆。
2. 要求 `explicit=true`，否则丢弃候选。
3. 校验类别值、数量上限（每任务最多 10 条）、长度和敏感字段。
4. 检查用户设置；关闭时任务成功结束但不应用候选。
5. 规范化 JSON 并计算值指纹。
6. 在事务内锁定同用户同类别 active 行，执行冲突规则。
7. 先插入任务结果唯一键；已存在则跳过该候选。
8. 写入或软删除记忆，更新主要标记。

模型原始输出不写数据库、不写普通日志、不返回前端。提取失败只写 `last_error_code`，例如 `MODEL_TIMEOUT`、`INVALID_OUTPUT`、`DATABASE_RETRYABLE`。

### 8.5 幂等与并发

- 任务级：`deduplication_key` 唯一。
- 候选级：`(task_id, operation_key)` 唯一。
- 资源级：active 值使用 `(user_id, category, value_fingerprint)` 部分唯一索引。
- 主要偏好：同用户同类别的更新在一个事务中完成，并锁定同类 active 行。
- 处理崩溃：记忆更新和任务结果写入在同一事务，不能出现“结果已记账但记忆未更新”。

## 9. 删除、生命周期和权限

### 9.1 单条和全部删除

删除只影响当前用户的 active 记忆。服务查询条件始终包含 `userId`；资源不存在和越权统一为 `404`。软删除行不参与读取、相关性排序或重复值匹配。

### 9.2 来源聊天删除

`ChatRecordsService.deleteForUser` 在删除会话前调用 `UserMemoryLifecycleService.markConversationDeleted(conversationId)`，在同一事务中：

1. 将该会话来源的记忆 `source_status` 更新为 `deleted`。
2. 删除聊天会话及其消息、trace（沿用现有级联）。
3. 数据库外键将 `source_conversation_id` 置空。

页面只显示“原聊天已删除”，不允许跳转到不存在的会话。记忆值不会随来源聊天删除而删除。

### 9.3 账号删除

当前用户模块只有管理员逻辑禁用，没有账号物理删除接口。后续实现账号删除时必须：

- 在同一事务中撤销 refresh session；
- 删除 `users` 行，依靠外键级联清理设置、记忆、任务和任务结果；
- 不提供普通接口恢复已删除记忆；
- 增加账号删除的数据库和 HTTP 测试。

### 9.4 权限

| 场景                    | 处理                                                          |
| ----------------------- | ------------------------------------------------------------- |
| 未登录                  | JWT Guard 返回 `401`                                          |
| 游客                    | 没有用户身份，不暴露记忆接口，返回 `401`                      |
| 访问他人记忆 ID         | 查询带 `userId`，统一 `404`                                   |
| 伪造 `userId` 或来源 ID | schema 拒绝未知字段或服务端完全忽略，返回 `400`               |
| 管理员普通接口          | 与普通用户相同，只能访问自己的记忆；不新增管理员记忆原文接口  |
| 禁用用户                | 沿用现有 Guard 拦截；任务处理器发现用户已禁用时不再注入或提取 |

## 10. 错误、日志与安全

### 10.1 HTTP 错误映射

| 场景                     | 状态                   | 对外消息原则                              |
| ------------------------ | ---------------------- | ----------------------------------------- |
| schema、未知字段、非法值 | `400`                  | 返回字段级校验错误，不返回 SQL 或模型原文 |
| 未登录                   | `401`                  | 沿用现有 JWT 错误                         |
| 资源不存在或越权         | `404`                  | 不泄露资源是否存在                        |
| 重复值                   | `200/201` 幂等成功     | 返回最终资源，不泄露并发细节              |
| 数据库唯一冲突           | `409` 或转换为幂等成功 | 不返回 SQL                                |
| 模型提取失败             | 不影响已完成聊天       | 任务内部重试，前端不感知                  |

### 10.2 日志

允许记录：任务 ID、用户 ID 的不可逆短哈希、类别、状态、尝试次数、耗时和错误分类。

禁止记录：API Key、密码、Token、完整聊天原文、模型原始响应、完整记忆值、来源消息内容和候选推理。日志中的用户 ID 使用短哈希，便于关联而不直接暴露身份。

### 10.3 内容过滤

- 只允许第一版类别枚举。
- `avoidance` 和 `color` 的短词执行控制字符、凭据模式、邮箱、手机号和 URL 过滤。
- 命中健康诊断、身份证件、账号、薪资、银行卡和认证凭据关键词的候选直接丢弃，并只记录 `SENSITIVE_REJECTED`。
- 系统提示要求模型不要推测；服务端仍把 `explicit`、类别和值 schema 作为最终防线。
- 返回前端的值来自结构化 mapper，不返回 `deleted` 行和内部任务字段。

## 11. 测试与全链路验证

### 11.1 单元测试

- 每个类别的合法值、边界值、未知字段、错误类型和 `budget min > max`。
- `z.input` 的 URL 字符串转换、默认 `pageSize` 和 `z.output` DTO。
- `StandardSchemaValidationPipe` 对 Body、Query、Param 的 `400` 映射。
- 相关性排序、512 token 限制和当前消息优先级。
- 冲突合并、主要偏好唯一性、软删除和重复值指纹。
- 关闭设置后的读取和提取跳过。
- 提取 JSON 解析失败、敏感候选丢弃和候选数量上限。
- 任务退避、processing 超时回收和重复结果唯一键。

### 11.2 HTTP 测试

使用测试数据库和 Fake Structured Text Generation Port：

- 登录用户增删改查和设置开关。
- 未登录、游客、越权 ID、伪造 `userId`、未知字段和非法值。
- 删除全部必须 `confirm: true`。
- 资源响应不包含 `userId`、指纹、任务字段和敏感内部字段。
- 来源会话删除后记忆仍存在且 source status 为 `deleted`。

### 11.3 真实数据库和全链路 Smoke Test

必须走真实 HTTP、PostgreSQL 和模型端口替身或配置的测试模型，覆盖：

1. 注册用户 A，完成第一轮文本聊天并确认任务入库。
2. 任务处理后，新建第二个会话，确认相关记忆进入模型输入。
3. 用户 B 尝试读取、修改和删除 A 的记忆，均返回 `404`。
4. 重复投递同一任务，确认 active 记忆只有一条。
5. 在任务处理期间关闭记忆，确认任务成功结束但不写入。
6. 删除来源聊天，确认记忆保留且不可跳转来源。
7. 模型超时和无效 JSON，确认聊天 HTTP 已成功、任务按退避重试且不产生记忆。
8. 删除账号后确认设置、记忆、任务和结果表均无残留。

真实供应商调用只作为显式 Smoke Test，不进入默认自动化测试，不使用生产密钥。

## 12. 验证命令

技术文档确认并完成实施后，至少运行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
```

数据库迁移验证使用：

```bash
pnpm --filter @clothes-shopping-guide/api migration:up
pnpm --filter @clothes-shopping-guide/api migration:down
```

`migration:fresh` 只允许在明确可销毁的本地或 CI 数据库使用，不作为普通功能验证命令。

## 13. 技术风险与后续确认

| 风险                     | 当前处理                                         | 后续边界                                       |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------- |
| 进程内轮询器吞吐有限     | 数据库任务可恢复、批量领取和退避                 | 吞吐达到阈值后替换为队列，保留任务状态和幂等键 |
| 关键词相关性不如语义检索 | 类别枚举、主要偏好和 token 上限控制误注入        | 有真实效果指标后再评估 Embedding               |
| 来源会话删除与任务并发   | 删除前标记来源，任务只使用消息 ID 并检查来源状态 | 后续可增加任务取消状态                         |
| 结构化值枚举覆盖有限     | `other` 和短词字段提供有限扩展                   | 新增类别必须更新契约、schema、迁移和测试       |
| 当前账号没有物理删除     | 外键已为未来删除准备级联                         | 增加账号删除能力时补充独立契约和审批           |

本技术文档确认后，下一步只能编写 `docs/user-memory/user-memory-implementation.md`，并在实施文档获确认前继续禁止修改业务代码。
