# 用户长期记忆技术文档

## 完整拆分修订说明（2026-11-04）

本文件是此前混合方案的历史技术记录，其中共用任务、开关及读取方案已被完整拆分取代。[完整拆分设计](./user-preference-memory-separation-design.md)、独立契约、[拆分技术文档](./user-preference-memory-separation-technical.md) 和 [拆分实施文档](./user-preference-memory-separation-implementation.md) 均已确认并实施，当前行为及验证记录以新文档为准。

## 状态与审批边界

- 状态：已确认，实施中
- 上一阶段：新版设计文档与 CRUD 契约已确认
- 当前阶段：实施文档已确认，正在实现与验证
- 下一阶段：完成验证并记录实际交付结果
- 实施限制：实现须遵守已确认的设计、契约和实施文档
- 最后更新：2026-11-03

本文覆盖新增的用户级 Markdown 长期记忆文档及其与现有结构化用户偏好、聊天静默提取的集成。现有结构化偏好实现继续保留。

## 1. 技术目标与关键选择

### 1.1 目标

1. 每位登录用户拥有一份自由格式 Markdown 记忆文档，正文实际存储为七牛云 Kodo 对象。
2. 现有结构化服装偏好保留，现有记忆开关同时控制结构化偏好与 Markdown 文档的提取和注入。
3. 文档以服装、穿搭和购物信息为主，其他有助于个性化协作的长期背景为辅；健康、身份、财务等敏感个人信息不写入。
4. 用户可通过认证 API 读取、编辑和清空整份文档。
5. 聊天静默提取与人工编辑并发时不丢失用户内容；旧任务不能在用户清空后恢复旧文档。
6. 对象存储失败、模型失败和任务重试不阻断已经完成的聊天回复。

### 1.2 技术选择

| 领域           | 选择                                                               | 原因                                                     |
| -------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| 业务归属       | 现有 `apps/api/src/user-memory/` 模块                              | 保持记忆资源的权限、提取和读取边界                       |
| Markdown 正文  | 七牛云 Kodo 私有 Bucket，Node.js 服务端 SDK `qiniu` 读写           | 用户明确指定七牛云；私有空间避免对象匿名读取             |
| 对象命名       | `user-memory/<user-uuid>/<revision>-<random-id>.md`                | 服务端从认证用户派生对象键，每个 revision 使用不可变对象 |
| 协调元数据     | PostgreSQL + MikroORM 保存当前对象键、revision、摘要和清空代次     | 数据库只存对象元数据、不存正文；事务指针协调跨实例写入   |
| 同用户写入互斥 | PostgreSQL 行锁或事务级 advisory lock                              | 同一用户的 API 更新、提取更新和清空操作串行化            |
| 手动编辑冲突   | API 使用 `expectedRevision` 乐观锁，冲突返回 `409`                 | 避免旧页面覆盖新内容                                     |
| 旧任务清空隔离 | 提取任务登记时捕获 `documentGeneration`；清空时递增                | 旧任务仍可维护结构化偏好，但不能复活清空前的 Markdown    |
| Markdown 显示  | 复用现有 `MarkdownRenderer.vue` 和 `@crazydos/vue-markdown`        | 本地已有渲染封装和 GFM 插件，不引入第二套实现            |
| 记忆检索       | 复用现有关键词排序方式，将文档切分为文本块后排序；不引入 Embedding | 保持第一版依赖和上下文预算简单、可验证                   |

### 1.3 部署前提

- 每个 API 实例通过服务端配置访问同一个七牛 Kodo 私有 Bucket；对象存储承担跨实例持久化，不依赖 API 本地磁盘。
- 所有实例必须连接同一个 PostgreSQL，并通过数据库锁协调每位用户的写入。
- Bucket 必须配置为私有空间；API 不将七牛对象 URL 或下载凭证返回给客户端。
- 自动化测试通过对象存储端口 fake 验证，不要求真实七牛凭据或外网。

## 2. 现有模块和依赖调查

### 2.1 已有实现

- `UserMemory` 保存结构化服装偏好；`UserMemorySetting` 保存现有 `enabled` 开关。
- `UserMemoryTask`、`UserMemoryTaskResult` 和 `UserMemorySchedulerService` 提供数据库任务队列、幂等处理、重试与多实例任务领取。
- `UserMemoryReaderService` 为聊天生成受限记忆上下文。
- `ChatRecordsService` 在聊天完成后登记任务，并在聊天请求前读取记忆。
- `StandardSchemaValidationPipe` 已全局启用，Controller 使用 Nest 参数装饰器绑定 Zod schema。
- API 的当前 Node 版本为 `22.19.0`；Web 已安装 `@crazydos/vue-markdown@1.1.4`，并通过 `MarkdownRenderer.vue` 开启 sanitize。
- 本地没有七牛 SDK；七牛官方 Node.js SDK 包名为 `qiniu`，支持服务端上传、对象管理和私有资源下载签名，兼容当前 Node 运行时。

### 2.2 依赖选择

- API 在 `apps/api` 增加七牛官方 Node.js SDK `qiniu`；仅由 user-memory 模块内的对象存储适配器封装 SDK。
- API 继续使用现有 NestJS、MikroORM、PostgreSQL、Zod 和结构化文本生成端口。
- Web 继续复用现有 Markdown Renderer；不添加新的编辑器或 Markdown 解析依赖。编辑输入使用原始 Markdown 文本控件，预览使用现有 Renderer。

### 2.3 官方文档

- 七牛 Node.js SDK：<https://developer.qiniu.com/kodo/sdk/nodejs>
- 七牛私有资源下载：<https://developer.qiniu.com/kodo/1656/download-private>
- 七牛私有 Bucket 访问控制：<https://developer.qiniu.com/kodo/8603/dev-access-control>
- NestJS 配置：<https://docs.nestjs.com/application/configuration>
- NestJS 生命周期：<https://docs.nestjs.com/fundamentals/lifecycle-events>
- NestJS Pipes：<https://docs.nestjs.com/pipes>
- MikroORM 事务：<https://mikro-orm.io/docs/transactions>
- MikroORM Migration：<https://mikro-orm.io/docs/migrations>
- PostgreSQL advisory locks：<https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS>
- Zod 4 API：<https://zod.dev/api>
- 本地 Markdown Renderer 文档：`apps/web/node_modules/@crazydos/vue-markdown/README.md`

七牛官方 Node.js SDK 支持服务端上传、区域配置、对象管理和私有下载凭证。记忆正文由 API 服务端上传和读取；实现须将对象存储超时、错误码和凭证处理封装在适配器内。AK/SK 仅保存在服务端环境配置，不得进入前端、日志、API 响应或测试样例。

## 3. 模块结构

只在现有模块内新增紧密相关职责，不跨模块共享 Entity 或 Service：

```text
apps/api/src/user-memory/
├── user-memory.module.ts
├── controller/
│   └── user-memory.controller.ts
├── service/
│   ├── user-memory.service.ts
│   ├── user-memory-document.service.ts
│   ├── user-memory-document-store.service.ts
│   ├── user-memory-reader.service.ts
│   ├── user-memory-extractor.service.ts
│   ├── user-memory-task.service.ts
│   └── user-memory-lifecycle.service.ts
├── entity/
│   ├── user-memory-document-state.entity.ts
│   ├── user-memory-setting.entity.ts
│   └── user-memory-task.entity.ts
├── dto/
│   └── user-memory-document.dto.ts
├── context/
│   ├── memory-document.schema.ts
│   ├── memory-document-patch.schema.ts
│   ├── memory-document-context.ts
│   └── memory-safety.ts
└── spec/
    ├── user-memory-document.service.spec.ts
    ├── user-memory-document-store.service.spec.ts
    ├── user-memory-document.http.spec.ts
    └── memory-document-context.spec.ts
```

实际实施时沿用已存在文件；目录树是职责目标，不要求机械迁移现有类。`UserMemoryDocumentStoreService` 封装七牛 SDK、私有对象上传/下载/删除和对象键派生；Controller 不直接访问对象存储。

## 4. 持久化模型

### 4.1 Kodo 对象布局

```text
<private-bucket>/
└── user-memory/<user-uuid>/<revision>-<random-id>.md
```

- Bucket 必须为私有空间。`user-uuid` 只能来自已认证 `@CurrentUser()`；任何 API 均不接收文件路径或存储对象键。
- revision 由数据库状态行维护。对象键带随机后缀且不可覆盖；只有状态行当前 `object_key` 指向的对象是有效正文，未被引用的对象由延迟清理任务回收。
- Revision 0 表示尚无文档对象，读取结果为 `content: ""`、`revision: 0`；`updatedAt` 返回状态行初始化时的服务端时间。
- 正文仅保存在 Kodo 对象；数据库不存储 Markdown 正文副本、模型原始输出或完整聊天文本。

### 4.2 数据库元数据

新增 `user_memory_document_states` 表：

| 字段                  | 类型           | 约束/用途                                                  |
| --------------------- | -------------- | ---------------------------------------------------------- |
| `user_id`             | `uuid`         | 主键，同时外键关联 `users.id`，账号清理时级联删除          |
| `revision`            | `integer`      | 当前文档版本，初始为 `0`；内容实际变化时递增               |
| `object_key`          | `varchar(512)` | 当前版本的私有对象键；revision 0 为 `NULL`                 |
| `document_generation` | `integer`      | 清空代次，初始为 `0`；每次清空递增                         |
| `content_hash`        | `char(64)`     | 当前对象 UTF-8 正文的 SHA-256；Revision 0 保存空字符串摘要 |
| `updated_at`          | `timestamptz`  | 状态行初始化或文档最后成功变更的服务端时间                 |

现有 `user_memory_tasks` 增加 `document_generation` 整数列。任务登记时读取当前状态代次并写入任务；迁移前已存在任务的默认代次为 `0`。

新增 `user_memory_document_task_results` 表记录文档候选幂等结果：

| 字段            | 类型           | 约束/用途                                 |
| --------------- | -------------- | ----------------------------------------- |
| `id`            | `uuid`         | 主键                                      |
| `task_id`       | `uuid`         | 外键关联 `user_memory_tasks.id`，级联删除 |
| `operation_key` | `varchar(180)` | 任务内操作幂等键                          |
| `applied_at`    | `timestamptz`  | 操作完成时间                              |

对 `(task_id, operation_key)` 建唯一索引。新建独立结果表，避免把 Markdown 操作硬塞进现有只支持结构化偏好 `upsert/delete` 的 `user_memory_task_results`。

`user_memory_settings.enabled` 不新增字段，继续作为结构化偏好和 Markdown 文档共用开关。

新增 `user_memory_document_cleanups` 持久化延迟清理队列，包含唯一对象键、可空用户 ID、重试次数和下次执行时间；不设置用户外键，避免账号删除时失去回收记录。旧对象和已上传的新对象在数据库指针切换时登记或取消清理；后台在至少七天后确认没有状态行引用再删除，失败延迟重试。定期分页巡检固定前缀下的旧对象，补登记上传后进程退出而未留下队列记录的孤儿。

### 4.3 迁移与旧数据兼容

- 新增单独 MikroORM migration：创建文档状态表和文档任务结果表，为任务表添加 `document_generation NOT NULL DEFAULT 0`，补充对象键字段、外键、非负检查约束和索引。
- 不迁移、不删除、不重写现有 `user_memories` 行；旧结构化偏好 API 和数据继续工作。
- 文档对象在用户首次编辑或首次提取成功时创建；不需要为现存用户预生成空对象。
- `up`/`down` 迁移需审查 SQL 和外键行为。回滚新增数据库结构前，先停止 API 写入并备份/清理对应对象；Migration 本身不得批量删除用户对象。
- 当前用户模块只实现逻辑禁用，没有账号物理删除接口。若后续增加物理删除，生命周期服务必须安排对象清理并保留失败重试机制。

## 5. 对象写入和一致性协议

### 5.1 初始化和配置

- 新增 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`、`QINIU_BUCKET`、`QINIU_REGION` 和 `QINIU_DOMAIN` 配置，后续实施时同步写入根目录 `.env.example`，仅使用占位值。
- `QINIU_REGION` 为可选配置，使用七牛官方区域标识；官方 SDK 可在未配置时按 AK 与 Bucket 查询区域，部署网络不适合区域发现时再显式设置。`QINIU_DOMAIN` 为 Bucket 绑定且可从 API 服务端访问的生产下载域名。七牛私有空间读取通过服务端 SDK 生成短时下载签名，再由 API 服务端请求该 URL 并代理内容；建议签名有效期不超过 60 秒，且永不返回浏览器或写入日志。七牛测试域名不用于私有 Bucket。
- 区域应按七牛当前 SDK 配置方式设置；官方文档说明上传配置支持区域 ID，未设置时可通过 AK 与 Bucket 查询区域。
- 通过现有 `ConfigService` 校验配置。配置缺失或无效时，对象存储能力报告不可用并告警；不得回退到本地磁盘或数据库存正文。普通聊天沿用记忆不可用时跳过记忆的降级语义。
- AK/SK 使用最小必要权限并支持轮换。凭据、上传 token 和私有下载签名 URL 不进入日志、API 响应或测试样例。

### 5.2 版本化写入

人工编辑、静默提取更新和清空统一走 `UserMemoryDocumentService`：

1. 在事务内取得该用户的 PostgreSQL 事务级 advisory lock；首次访问时幂等创建状态行。任务登记、文档读取、人工更新、静默提取和清空必须使用同一锁键，读取可使用共享锁。
2. 人工写入时核对 `expectedRevision`；不匹配立即返回 `409`，不访问对象存储。
3. 读取数据库当前 `object_key` 指向的私有对象：服务端生成仅用于本次请求的短时签名 URL 并由 API 服务端请求内容，校验 `content_hash` 后再由认证 API 返回给本人；对象缺失或摘要不一致属于存储故障，返回 `503`，不伪装为空文档。
4. 通过官方 SDK 上传 UTF-8 Markdown 到全新、不可变的 revision 对象键；上传时不覆盖已有对象。
5. 上传成功后更新状态行的 `revision`、`object_key`、`content_hash`、`updated_at`，必要时更新 `document_generation`，然后提交数据库事务。
6. 数据库提交失败时新对象成为孤儿，不影响旧对象指针；孤儿对象由可观测的延迟清理任务回收。上传失败时不改数据库状态并返回 `503`。
7. 数据库事务成功后旧对象进入延迟清理队列；确认对象不再被任何状态行引用后才允许删除。删除失败可重试，不回滚已完成的用户写入。

数据库锁保证多实例同用户互斥。对象存储与 PostgreSQL 不共享事务，因此先上传不可变对象、再切换数据库指针；数据库始终决定当前版本。API 只读取状态行指向的对象，不通过列举对象猜测当前版本。

### 5.3 清空和旧任务隔离

- 清空操作在数据库锁下将当前指针切换到 `object_key = NULL`、空摘要并递增 `document_generation`；仅当原文非空时递增 revision，且不上传零字节对象。
- 已登记任务携带登记时的 `document_generation`。提取任务完成模型调用后，在最终应用更新前重新读取当前 generation；不相等时跳过该任务的 Markdown 更新。
- Generation 不匹配只跳过 Markdown 更新，不阻止同一任务对现有结构化用户偏好执行已批准的操作。
- 用户关闭现有记忆开关时，停止结构化偏好和 Markdown 的提取/注入；未完成任务在应用结果前重新读取设置并跳过两类写入。

### 5.4 备份与恢复

- Kodo 对象与 PostgreSQL 状态必须纳入同一受控备份/恢复策略，保证状态指针引用的对象仍可用；策略需明确对象版本保留、误删恢复及灾备能力。
- 恢复期间暂停 API 写入和任务调度器，恢复数据库快照及其引用的对象版本，再校验每个非零 revision 对应对象存在且内容摘要一致。
- 发现状态行指向缺失对象时，对受影响用户返回存储服务不可用并告警，不自动覆盖为空内容。
- 生产环境备份必须加密并限制运维读取权限；管理员业务 API 不因备份能力获得记忆原文访问权限。

## 6. API、Schema 与响应

全局使用现有 `StandardSchemaValidationPipe`；输入 schema 放在 `user-memory/dto/`，使用 Zod 4 `z.strictObject`。

### 6.1 读取文档

`GET /api/memories/document`

响应：

```ts
type UserMemoryDocumentResponse = {
  content: string;
  revision: number;
  updatedAt: string | null;
};
```

认证用户从 `@CurrentUser()` 解析；不接收 `userId`、revision 路径参数或文件名。

### 6.2 替换文档

`PUT /api/memories/document`

```ts
const updateMemoryDocumentSchema = z.strictObject({
  content: z.string(),
  expectedRevision: z.number().int().min(0),
});
```

- `content` 最大 `32 * 1024` UTF-8 字节；用 Zod refine 基于 `Buffer.byteLength(content, 'utf8')` 校验，不使用 Controller 手写分支。
- 拒绝 NUL 和不合法 Unicode 内容；空字符串等价于清空并遵循 generation 与旧文件清理规则，UI 优先调用 DELETE 以便明确表达意图。
- 写入前运行认证凭据和健康、身份、财务等敏感内容检查；拒绝时返回 `400`，不记录被拒绝的正文。
- revision 不匹配返回 `409`，响应只提供错误码；客户端重新 GET 后由用户决定覆盖或合并，不能自动丢弃编辑。
- 成功返回保存后的文档 response。

### 6.3 清空文档

`DELETE /api/memories/document`

- 不接收 Body；成功返回 `204`。
- 每次显式清空都递增 `document_generation`，即使文档已经为空，以阻止清空前登记的任务随后创建内容。
- 仅当当前内容非空时生成新的空 revision；当前已为空时保留 revision，只更新代次。
- 清空先提交空指针和新 generation，再将旧对象加入延迟清理；即使对象删除失败，读取也只返回空文档，后台持续重试清理。
- 此操作只清空 Markdown 文档，不删除 `user_memories` 行、设置或聊天记录。

### 6.4 现有 API 与 OpenAPI

- 现有 `GET/POST/PATCH/DELETE /api/memories` 偏好 CRUD 和 `PATCH /api/memories/settings` 保持；设置 API 响应不变。
- 所有新 API 增加 Swagger 装饰器与安全响应 DTO，不返回对象键、存储 URI、下载凭证、文档代次、数据库 Entity 或任务信息。
- Controller 只负责请求 schema 绑定、当前用户解析、调用 Service 和 HTTP 响应，不包含对象存储 I/O。
- `DELETE /api/memories/document` 静态路由必须先于 `DELETE /api/memories/:id` 注册，避免 `document` 被动态 UUID 参数路由截获。

## 7. 静默提取与文档合并

### 7.1 任务流程

```text
聊天持久化事务
  -> 沿用 user_memory_tasks 登记
  -> 任务记录 document_generation
  -> 提取器读取该用户当前 Markdown 和本轮 user/assistant 消息
  -> LLM 返回受 Zod 校验的有限操作候选
  -> 检查开关、任务 generation、敏感信息和当前文档 revision
  -> 在用户行锁下对当前文档应用候选并版本化写入
  -> 标记任务成功或按现有退避策略重试
```

任务唯一键、`FOR UPDATE SKIP LOCKED` 领取和最大尝试次数沿用现有实现。结构化偏好继续写入现有 `UserMemoryTaskResult`；Markdown 操作写入独立的 `user_memory_document_task_results` 幂等表。聊天消息和 trace 不因 Markdown 存储改变。

### 7.2 模型候选

模型不返回完整替换文档，避免模型重写或遗漏用户手动内容。候选采用严格 JSON schema：

```ts
type MemoryDocumentOperation =
  | {
      operation: 'append';
      section: 'clothing' | 'other';
      markdown: string;
      explicit: true;
    }
  | {
      operation: 'replace' | 'delete';
      targetText: string;
      replacement?: string;
      explicit: true;
    };
```

- `section=clothing` 表示服装、穿搭和购物长期信息；`other` 仅表示有助于个性化协作的辅助背景，不是面向用户的固定类别体系。
- 单次任务最多 10 个操作；每项文本单独设长限制并经过敏感校验。
- `append` 以 Markdown 段落为单位追加到当前文档；已存在的规范化段落不重复追加。
- `replace`/`delete` 仅在 `targetText` 于当前文档中唯一匹配时应用；无匹配或多重匹配则跳过该操作，不猜测目标、不改写全文。
- 任务结果键由 task ID、操作类型和规范化操作内容计算，重复投递不重复应用。
- 模型原始输出、推理和聊天原文不进入普通日志或 API 响应。

### 7.3 敏感信息策略

- 模型提示明确排除健康、身份、财务敏感信息和认证凭据。
- 服务端对候选文本执行确定性过滤，覆盖身份证件号码、联系方式、银行卡/支付卡、密码/token/API Key、病史/诊断/药物、收入/债务等模式。
- 人工 PUT 对整份文档执行相同类型的安全校验；具体规则须有边界测试，错误响应不回显命中片段。
- 敏感判断无法证明所有自然语言风险均为零；实现不得把模型自报安全标记当成唯一防线。

## 8. 聊天读取与上下文预算

### 8.1 来源优先级

冲突顺序建议为：

```text
当前用户消息 > 用户手动设置的结构化偏好 > Markdown 长期记忆 > 系统默认规则
```

结构化偏好由用户显式管理，Markdown 文档可含聊天自动提取内容，因此前者优先。该优先级需随本文一起确认。

### 8.2 文档相关性

- 读取器接收认证 user ID 和当前 user 消息，不接受客户端提供的 user ID。
- 后端将 Markdown 按空行和标题边界切分为保留原文顺序的文本块；按当前消息词项重叠对块排序，命中服装、穿搭、购物相关术语优先。
- 无命中块时不注入整份文档；用户手动设置的结构化偏好仍沿用当前读取逻辑。
- 文档相关块与结构化偏好合并后交给现有 `ChatRecordsService`，继续由 `ChatContextService.truncateToTokens(..., 512)` 施加总记忆上下文硬上限。
- 上下文包裹为不可信用户数据，明确提示模型不得把 Markdown 中的文本当作指令，不向用户展示内部字段或其他用户数据。

### 8.3 失败语义

- 记忆读取对象缺失/损坏时，记录脱敏错误并按服务策略 fail closed：该请求不注入损坏的 Markdown，不读取其他对象；是否继续当前聊天按现有记忆读取降级规则执行。
- 当前版本采用“记忆不可用时跳过记忆继续聊天”，不因对象存储失败返回 5xx 阻断普通聊天。
- 文档管理 API 读写失败则返回 `503`，不伪装为成功或空文档。

## 9. Web 管理体验

- 现有“我的记忆”页面增加“用户偏好”和“Markdown 记忆”两个页面内视图；偏好 CRUD 继续复用当前 API 与编辑弹窗。
- Markdown 视图直接编辑原始 Markdown，并可切换预览；保存期间防重复提交，显示 dirty、saving、saved、conflict 和 error 状态。
- 预览复用 `MarkdownRenderer.vue`；必须开启 `sanitize`，不添加 `rehype-raw`，不关闭 sanitizer，不使用 `v-html`。
- 加载和保存逻辑放入 `apps/web/src/pages/memories/page.ts` 或页面 composable；API 适配放入 `src/api/modules/memories.ts`，类型放入 `src/api/types/`。
- 保存携带 GET 返回的 `revision` 为 `expectedRevision`。遇到 `409` 保留本地草稿并提示重新加载/比对，不自动覆盖。
- 清空 Markdown 使用独立确认操作，不与现有结构化偏好“删除全部”混淆。

## 10. 安全、日志与运维

- 仅认证用户访问自己的资源；所有操作使用 `@CurrentUser()` 和服务端对象键派生。
- Bucket 配置为私有；管理 API 全程由服务端访问对象，不向客户端返回对象键、URL、下载 token 或七牛凭据。
- 禁止对 Markdown 正文、完整聊天内容、模型输出、AK/SK、上传 token 和签名 URL 打日志。
- 允许日志：用户 ID 的不可逆短哈希、revision、操作类型、耗时、任务 ID 和错误代码。
- 敏感校验失败只记录 `SENSITIVE_REJECTED`，不记录命中内容。
- 对象存储连通性、孤儿对象清理和数据库指针完整性检查纳入健康/运维指标；健康检查不得泄露凭据或签名 URL。
- 七牛环境配置必须同步加入根目录 `.env.example` 和部署文档；示例只用占位值，不提交真实 AK/SK。

## 11. 测试策略

### 11.1 对象存储适配器测试

- 对象键只从认证 user UUID 和服务端 revision 派生；API 输入无法控制 bucket、对象键或下载 URL。
- 首次读取空文档；当前 revision 可正确下载；对象缺失、权限错误和摘要不一致不可伪装为空文档。
- 上传对象成功后再提交数据库指针；上传失败或数据库提交失败时旧版本继续可读。
- 删除只作用于不再被任何状态行引用的对象；删除失败可重试，不能影响已提交的新状态。
- 私有下载凭证、SDK 请求 token 和 AK/SK 不返回、不写日志；签名过期、网络超时和限流映射为可恢复错误。
- UTF-8 大小边界、NUL、换行和 Unicode 内容行为。
- 多实例并发调用通过数据库协调锁保护；自动化测试使用 fake，不依赖真实七牛服务。

### 11.2 Service 和 schema 测试

- `GET/PUT/DELETE` 合法请求、未知字段拒绝、字节上限边界、错误 revision 的 `409` 和幂等清空。
- 用户 A/B 文档隔离、游客 `401`、伪造 user ID 不生效、管理员普通接口无旁路。
- 健康、身份、财务、凭据、证件、电话、邮箱和银行卡模式被拒绝；安全服装偏好正常保存。
- 用户偏好与 Markdown 文档共享开关；关闭后读上下文为空且提取不写两类记忆。
- 对象 revision 指针更新、并发冲突、孤儿对象和账号清理失败行为。
- 新 Zod body 与现有 `StandardSchemaValidationPipe` 覆盖合法/非法值、未知字段和 HTTP 400。

### 11.3 提取与读取测试

- 模型只能返回严格操作候选；整篇文档覆盖输出、未知操作、非明确候选和敏感候选被拒绝。
- append 去重；唯一 target 的 replace/delete 生效；缺失或重复 target 跳过且不损坏手工内容。
- 用户编辑和提取并发时，补丁应用到最新文档；expectedRevision 冲突不会覆盖草稿。
- 清空前登记的任务因 generation 不匹配不能恢复 Markdown 文档，但仍按设置处理结构化偏好。
- 相关性排序、无命中时不注入全文、结构化偏好优先级和总计 512-token 限制。
- 对象存储不可用不阻断普通聊天；记忆管理 API 对象读取/上传错误返回 `503`。

### 11.4 Smoke Test 与迁移验证

1. 对已有用户执行迁移，确认原结构化偏好、开关和聊天均可用。
2. 用户 A 保存文档后，用户 B 和游客无法读取；数据库不含 Markdown 正文，私有对象不能匿名下载。
3. 两个 API 实例访问同一私有 Bucket 和 PostgreSQL，并发更新同一用户文档，无半写入或静默覆盖。
4. 静默提取将服装信息写入文档，相关后续聊天读取该文档；敏感和临时内容不写入。
5. 清空文档与旧任务并发，确认旧任务不复活文档且既有偏好行为保持预期。
6. 重启 API 后文档仍存在；恢复一致备份后 revision 指针和对象内容匹配。
7. 对象存储配置缺失、签名下载过期、限流和超时时，管理 API 明确返回不可用状态，不静默切换存储。

禁止使用真实生产密钥或不可控外网作为自动化测试依赖。数据库迁移不得用 `migration:fresh` 验证普通功能。

## 12. 验证命令

实现并获得实施审批后至少执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm check
```

数据库迁移需单独审阅 SQL，并在明确可销毁的测试数据库执行 `migration:up`/`migration:down`。验证完毕不得在用户数据库执行 destructive reset。

## 13. 部署与运行风险

1. 七牛 Bucket 区域、下载域名、生产 AK/SK 权限范围和对象备份/版本保留策略需在部署阶段配置并验证；密钥必须支持轮换。
2. 文档记忆候选操作使用精确目标文本补丁；用户大幅改写文档后旧目标不再匹配时，该候选会安全跳过，用户可通过直接编辑补齐。
3. 敏感信息过滤包含规则匹配，无法完全替代语义判断；需以严格模型提示、服务端规则和测试共同降低风险。
4. 版本化对象与数据库状态需要配套备份；恢复时必须校验指针完整性，不能只恢复数据库或只恢复对象。
5. 结构化偏好优先于 Markdown；该优先级已纳入实现，部署前仍需通过产品验收确认实际导购效果。
