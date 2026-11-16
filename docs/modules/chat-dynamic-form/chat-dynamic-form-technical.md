# 聊天动态表单技术文档

## 状态与依据

- 状态：已确认并已实施。
- 依据：[动态表单设计](./chat-dynamic-form-design.md)、[动态表单 CRUD 契约](../../contracts/chat-dynamic-form-crud-contract.md)。
- 所属应用：`apps/api`、`apps/web`。
- 最后更新：2026-11-13。

## 技术决策

| 主题           | 首版决策                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------- |
| 表单实例       | 持久化定义与生命周期，支持聊天历史恢复；不持久化用户填写值                                  |
| 定义和提交传输 | 定义通过现有聊天 SSE 的 `form` 事件；提交使用独立认证 HTTP API                              |
| 数据库边界     | 新建 `chat_dynamic_forms` 表；不修改购买草稿表结构                                          |
| 表单定义版本   | 生成时 `revision=1`；定义不可由客户端更新，字段变化创建新 `formId`                          |
| 提交并发控制   | 提交要求匹配服务端 revision；业务处理器的资源版本仍由领域模块校验                           |
| 幂等           | 表单仅成功提交一次；成功状态和安全结果引用持久化。重复请求返回第一次安全结果，不重放字段值  |
| 历史展示       | 只在展示信封存表单安全引用；历史读取时按本人会话查询当前定义和状态                          |
| 首版业务       | `purchase_recipient` 只更新已有当前购买草稿；购买上下文不活跃或没有草稿时不允许生成此类表单 |
| 结果消息       | 不另追加聊天消息；卡片在原 assistant 消息下展示，结果以卡片状态及安全 `form-result` 更新    |

提交值不保存在动态表单表、聊天展示信封、trace、工具 activity 或日志。动态表单状态与购买草稿写入并非同一数据库事务；若购买写入成功但表单状态更新前进程退出，重试将由购买草稿的 `expectedVersion` 冲突拦截，客户端重新读取表单和购买草稿以核实结果。该边界保证不会重复覆盖新版本，但不能保证跨模块的原子提交。

## 模块与依赖方向

### API

```text
apps/api/src/chat-dynamic-form/
  chat-dynamic-form.module.ts
  controller/
    chat-dynamic-form.controller.ts
  dto/
    chat-dynamic-form.schema.ts
    chat-dynamic-form-response.ts
  entity/
    chat-dynamic-form.entity.ts
  port/
    dynamic-form-handler.port.ts
  service/
    chat-dynamic-form.service.ts
    dynamic-form-registry.service.ts
  handler/
    purchase-recipient-form.handler.ts
  spec/
```

- `chat-dynamic-form` 拥有表单 schema、实例、状态转换、过期和处理器注册表。
- `chat-records` 创建表单时提供已认证用户、已验证会话、当前运行 ID 和安全 SSE 事件回调；它不读写表单 Entity。
- `llm` 工具只接收模型给出的表单意图，不接触 HTTP、Entity 或业务 Repository。
- 购买处理器依赖 `chat-purchase` 的公开写入 Port；不得引用 `PurchaseDraftService` 私有实现、购买 Entity 或 Repository。Port 输入显式包含当前服务端身份、会话、表单允许字段和当前草稿版本；用户身份绝不从模型参数读取。
- Web 只依赖公开 API 类型和字段渲染注册表，不依赖 API DTO 或后端 Entity。

现有 `ChatRecordsModule` 组合聊天、购买和展示能力；接入动态表单模块时由模块导入公开模块入口。为避免反向依赖，`chat-dynamic-form` 不导入 `chat-records`，创建入口由聊天编排层调用动态表单模块公开应用服务。

### 前端

```text
apps/web/src/
  api/modules/chat-dynamic-form.ts
  api/types/chat-dynamic-form.ts
  pages/chat/components/dynamic-form/
    ChatDynamicFormCard.vue
    formily-fields.ts
```

表单卡片嵌入现有 assistant 消息渲染，使用 Formily 管理 schema、字段状态、校验和提交值；Vue 控件通过 `@formily/vue` 的 SchemaField 组件注册机制映射到项目已有 shadcn-vue 输入、选择和复选框组件。仓库当前未安装 Formily，实施阶段须新增所需的 `@formily/core`、`@formily/vue` 及 Vue 响应式适配依赖，并核对当前版本的 peer dependency 与构建兼容性。

服务端表单 DTO 不直接作为可执行 Formily schema 使用。前端依据已校验 DTO 构造本地 schema，只能从静态字段类型映射表选择已注册组件；不接受 `x-component`、表达式、effects、scope、任意校验代码或远程 schema 扩展。Formily 的 JSON Schema 能力只负责受限字段的动态编排，不改变服务端字段白名单和业务校验边界。

## 数据模型

`ChatDynamicForm` 建议字段：

| 字段                                  | 类型             | 说明                                                |
| ------------------------------------- | ---------------- | --------------------------------------------------- |
| `id`                                  | UUID             | 服务端生成的 `formId`                               |
| `userId`                              | UUID             | 所属用户                                            |
| `conversationId`                      | UUID             | 所属会话                                            |
| `runId`                               | UUID             | 创建它的聊天运行                                    |
| `assistantMessageId`                  | UUID nullable    | 成功保存聊天回复后绑定                              |
| `formKind`                            | varchar/受限枚举 | 注册处理器标识                                      |
| `revision`                            | integer          | 首版为 1，定义不可原位更新                          |
| `definition`                          | JSONB            | 仅存服务端验证后的安全定义，不含用户值              |
| `status`                              | varchar/受限枚举 | `open`、`submitted`、`expired`、`cancelled`         |
| `resultReference`                     | JSONB nullable   | 仅保存业务类型和非敏感资源 ID，不保存联系方式或地址 |
| `createdAt`、`updatedAt`、`expiresAt` | timestamptz      | 生命周期时间                                        |

索引：`(user_id, conversation_id, created_at)`；`(conversation_id, assistant_message_id)`。查询和变更始终同时限定 `id + userId + conversationId`。不创建跨模块数据库外键到聊天或购买 Entity；会话存在性和归属由聊天会话 Access Port 校验。

定义 JSON 用 Zod strict schema 校验，最多 20 个字段，字段 key 在相应 `formKind` 白名单内。`definition` 中不保存模型原始参数；业务字段 schema 再由 handler 做第二次校验。

## API 与校验

### 聊天 SSE

沿用 `POST /api/llm/chat/stream`：

- `form` 事件只含 `form` 安全定义。
- SSE 不包含模型原始工具输入、用户填写值或提交 URL。
- 工具 activity 对 `request_dynamic_form` 采用通用脱敏投影，最多展示工具名称、运行状态和安全 formId；不得使用通用投影回显字段值。
- 保存 assistant 消息后将 `assistantMessageId` 绑定到实例，并纳入会话展示 envelope 的安全表单引用。
- 如果当前聊天事务未能保存消息，已创建的实例清理/孤儿策略需在应用服务中处理；过期清理任务不属于首版，读取时惰性标记过期。

### 读取恢复

```http
GET /api/chat/conversations/:conversationId/dynamic-forms/:formId
```

只返回本人会话中尚未过期的表单定义、状态和安全结果引用。历史展示恢复时，聊天详情服务批量投影绑定到 assistant 消息的动态表单；缺失、越权或损坏的引用不阻断消息正文。

### 提交

```http
POST /api/chat/conversations/:conversationId/dynamic-forms/:formId/submit
Content-Type: application/json
```

Body 使用 `z.strictObject`，含 `revision` 正整数和严格的 `values` 对象。请求 DTO 的通用约束为键数不超过表单字段数、字符串长度有界、禁止嵌套对象/数组；随后按持久化定义及 handler 的 `formKind` schema 校验具体值。`values` 只在请求内存中短暂存在，并传给 handler；禁止将其附加到异常、trace 或日志。

Controller 参数通过现有 `StandardSchemaValidationPipe` 绑定 Body、Param schema。Controller 只取 `@CurrentUser()`、路由参数和 DTO 并调用应用服务，不执行业务校验。

成功响应：

```json
{
  "formId": "uuid",
  "revision": 1,
  "status": "submitted",
  "result": {
    "kind": "purchase_draft_updated",
    "reference": {
      "draftId": "uuid",
      "version": 4
    }
  },
  "issues": []
}
```

`result.reference` 只含安全 ID/版本，不返回收件信息。字段错误使用 422 对应的既有异常映射；技术实现先检查当前 `DbExceptionFilter` 和 HTTP 错误映射以复用规范。资源归属错误统一 404；状态/revision/领域资源冲突 409；非法 body/未知字段 400；暂时不可用 503。

### 取消

```http
POST /api/chat/conversations/:conversationId/dynamic-forms/:formId/cancel
```

只允许拥有者将 `open` 表单转为 `cancelled`；重复取消返回当前安全状态。关闭表单不会修改购买草稿。

### Zod 契约清单

| 输入              | Schema 文件                                         | 未知字段策略                                            | 输出                                |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| 生成表单工具参数  | `chat-dynamic-form/dto/chat-dynamic-form.schema.ts` | strict；注册表二次约束 `formKind`、key/type/options     | 受约束的表单意图                    |
| 会话/表单路由参数 | 同上                                                | strict UUID                                             | `conversationId`、`formId`          |
| 提交 Body         | 同上                                                | 顶层 strict；values 只接收 string/number/boolean 原子值 | `revision`、`values`                |
| 业务字段值        | handler 所属 schema                                 | strict；不做隐式字符串/数字 coercion                    | 领域 Port 输入                      |
| API 响应          | 响应投影 schema                                     | strict 安全 allowlist                                   | 定义、状态、非敏感引用、公开 issues |

数值字段仅接受 JSON number，不从字符串自动转换；checkbox 为 boolean；手机号、姓名、地址为有长度上限的字符串。空白去除和业务规范化必须由 handler 显式定义，避免不同客户端产生不一致。

## 状态与并发

- 创建：`open`、revision 1、服务端 TTL 默认 24 小时。
- 提交：先锁定拥有者表单行并检查 `open`、revision、TTL，再验证字段及处理器注册状态。
- 业务 Port 成功后将状态更新为 `submitted` 并保存安全结果引用。
- 同一 formId/revision 的再次请求不再次执行业务处理器，返回持久化安全结果引用。
- 同一表单并发提交由行锁串行化；后续请求观察到 `submitted` 后返回幂等响应。
- 提交值不保留，因此提交成功后不支持恢复用户输入；重开或更改字段必须由新聊天运行生成新表单。
- 过期由读取/提交惰性转换为 `expired`；过期表单不可提交。后台清理和可配置 TTL 暂不纳入首版。
- 账号切换时前端清空未提交的内存值、Abort 请求并重新读取当前身份可访问的表单。

## 购买处理器

`purchase_recipient` handler 只在当前会话已有本人活跃购买草稿时创建表单。handler 通过购买公开 Port 读取允许字段及版本快照，形成经过服务端确认的字段定义：

- `skuId` 的选项必须来自该草稿商品当前可售 SKU；模型不能追加 SKU 或价格。
- `quantity` 范围、姓名/电话/地址长度和格式沿用购买 CRUD 契约。
- 不收集或回填草稿中已保存的姓名、电话和地址；已选择 SKU/数量可由服务端提供非敏感初值，但价格/库存不作为可写字段。
- 提交将 `formId` 映射到服务端创建表单时绑定的草稿 ID 和草稿版本；忽略客户端提供的资源身份。
- 写入只调用购买公开 Port 的 patch 能力；不执行 start、confirm、订单创建、支付或取消。
- 领域层返回版本冲突时 API 返回 409，表单维持 `open` 以便重新获取/重新填写，或由用户取消。

购买模块需新增稳定的公开 Port/Token 和模块导出；现有 `PurchaseDraftService` 保持模块内部实现细节。Port 返回独立安全 DTO，不返回 Entity。

## SSE、历史与前端状态

- 后端聊天事件联合类型、公开展示类型、SSE 序列化和聊天历史投影增加 `form`/表单引用支持；历史只存 `formId` 与必要关联，不复制字段值。
- 工具输入投影对动态表单工具使用拒绝默认策略，避免模型工具参数的 label、初值或意图污染通用 activity。
- 前端 `parseEventFrame` 只接受严格的 `form` envelope，并校验 UUID、revision、有限字段数、字段类型和 options 约束；不认识的 type 安全拒绝整张表单。通过校验后再转换为只含本地 `x-component` 映射的 Formily schema。
- Turn Store 将表单关联到 assistant message。新表单字段值仅保存在当前卡片组件的局部状态，不进入 Pinia 持久化、聊天请求 history 或 localStorage。
- Formily 表单实例只在卡片组件生命周期内创建；提交调用现有 API adapter，提交结果由服务端状态覆盖本地可编辑状态。
- 切换会话/账号时卸载卡片并丢弃未提交值；刷新页面后恢复安全定义，值为空。
- 提交中禁用重复确认；字段错误按 key 展示且保留本地值。422 可修改后再次提交；409/过期触发读取最新状态，状态不明时读取同一 formId 状态及购买草稿后展示核实结果；断网时不得自动生成新表单。
- `submitted` 展示成功/已提交状态，`cancelled` 与 `expired` 禁止编辑。

## 安全与日志

- 禁止日志打印提交 DTO、handler 原始输入、Zod issue 中的 `input` 值、手机号或详细地址。
- 请求校验错误只映射字段路径和固定公开文案；不将 Zod 内部错误对象原样回传或记录。
- 表单 `title`、`description`、label 和 placeholder 以纯文本渲染；不得用 `v-html`。
- API 不接受表单定义、`formKind`、用户 ID、会话 ID、提交目标或业务资源 ID作为提交端信任来源；定义全由 `formId` 服务端查出。
- 不记录请求体/响应体的通用 HTTP 日志策略必须在动态表单路由验证；如现有拦截器记录 body，提交路由需通过既有脱敏机制豁免。
- 用户值不得进入模型后续轮次和会话上下文摘要；仅领域模块按购买契约将成功值写入本人购买草稿。

## 迁移与兼容

- 新增 `chat_dynamic_forms` Entity 和增量 migration；不改既有聊天消息/购买草稿列。
- 展示 envelope 的新字段设为可选并提供空数组/空值默认，保持旧 JSON 历史可读。
- 新增表单事件不改变 `done` 的既有语义；`done` 仍只代表聊天消息持久化完成，不代表表单提交完成。
- 不使用 `migration:fresh` 验证。实施阶段用具名可销毁数据库验证 migration up、历史聊天读取、rollback 和再次 up。

## 测试策略

### API 单元与 HTTP

- Zod：合法定义/提交、额外键、未知 type/key、重复 key、无效 option、原子值类型、长度和字段数边界。
- Service：用户/会话归属、过期、revision 冲突、重复提交、并发提交仅调用一次 handler、取消状态转换。
- Handler/Port：购买字段映射、SKU 服务端白名单、草稿版本冲突、禁止正式订单动作、响应不含用户值。
- HTTP：401、404 越权归一、400 body/param、422 字段错误、409 状态冲突、503 依赖失败；异常和测试日志中断言敏感 fixture 不出现。
- 聊天集成：工具原始输入不进入 activity/trace 展示投影；仅安全表单事件进入 SSE；assistant message 与表单引用绑定；消息未成功保存时按孤儿策略处理。

### Web

- SSE parser 测试覆盖合法表单、未知字段、未知 type、超限字段、损坏 options 和无效 UUID 的安全拒绝。
- Formily 字段映射覆盖首版所有字段类型、required、select options、number、checkbox 及字段级错误；未知字段类型不能降级成任意组件。
- Store/组件验证会话切换、账号切换、重复提交、422 保留输入、409 重新读取、断网恢复和已完成表单禁用。
- 项目当前未接入 Vitest、Vue Test Utils 或 Playwright；不得为本阶段文档自行引入依赖。实施时先执行 Web 类型检查、lint/build，并将浏览器交互验收列为未覆盖项，除非测试基础设施后续获批。

### 仓库验证

实现批准后按 `docs/development/validation.md` 执行格式、API typecheck/test/build、`pnpm check`。数据库测试使用隔离具名数据库并检查 `RUN_*` 门控。共享构建目录和数据库验证串行进行。

## 风险与待确认

- 跨动态表单状态和购买草稿写入不在同一事务。购买模块拒绝跨模块事务耦合；首版使用购买草稿版本锁避免重复覆盖，并通过重新读取核实提交结果。若要求强原子性，需在实施审批前调整业务 Port 和事务所有权设计。
- 首版支持历史恢复定义/状态，但不会恢复尚未提交的值；这是避免在浏览器存储敏感信息的有意取舍。
- Formily 不是仓库现有依赖，需要新增前端依赖并验证 Vue 3、Vite、TypeScript 和当前组件库兼容；如果 peer dependency 或维护状态不满足要求，应在实现前重新审批替代方案，而不是静默换库。
- 是否允许购买表单收集 `skuId` 与购买草稿中已选择的 SKU 并行编辑，需与最终购买契约一致；技术文档暂按五个白名单字段支持，但实际 handler 仅暴露当前确实缺失且可由该表单安全修改的字段。
- 字段 422 错误的项目标准 HTTP 映射需在实现前检查现有异常过滤器；若当前无 422 映射，使用 Nest `UnprocessableEntityException` 并补充统一公开错误投影，不新建平行异常机制。

## 验收标准

- [ ] 技术边界不让 `llm` 或 Web 依赖动态表单/购买 Entity。
- [ ] 持久化只包含已验证定义、状态和非敏感结果引用，不含提交值。
- [ ] 表单定义走现有 SSE，提交/读取/取消使用有认证和 Zod 校验的 HTTP API。
- [ ] 同一表单并发/重复提交最多调用一次业务处理器。
- [ ] 购买 handler 通过公开 Port 更新当前本人草稿，不创建正式订单。
- [ ] SSE、trace、activity、历史和日志均不包含表单提交值。
- [ ] 页面刷新能恢复安全表单定义和状态；未提交输入不跨刷新保留。
- [ ] 提交结果未知时按同一 formId 和购买草稿状态核实，不盲目重复写入。
