# 收货地址簿与 LLM 查询技术文档

## 状态

- 状态：用户已于 2026-11-10 确认技术方案。
- 设计与 CRUD 契约：用户已于 2026-11-10 确认。
- 实现状态：核心技术方案已实现并通过 `pnpm check` 与 API 自动化测试；隔离 PostgreSQL Migration 测试和登录后浏览器 Smoke Test 待执行，详见[实施记录](./user-addresses-implementation.md)。
- 最后更新：2026-11-10。
- 上游文档：[设计](./user-addresses-design.md)、[CRUD 契约](../../contracts/user-address-crud-contract.md)。
- 关联现有契约：[订单](../../contracts/order-crud-contract.md)、[聊天购买](../../contracts/chat-purchase-crud-contract.md)。

## 实现目标

提供启用用户的本人收货地址管理页面与 API，并在聊天请求期间提供本人订单摘要查询、本人地址引用查询、已选地址写入当前购买草稿的 LangChain 工具。

模型工具不接收 `userId`，不返回完整地址/手机号/姓名，不执行地址簿写入或正式订单动作。新地址仅在用户点击结构化“保存地址”操作后写入。订单收货快照继续由订单模块保存，不依赖地址簿行的生命周期。

本技术方案不增加运行时依赖；复用现有 NestJS、MikroORM、Zod、LangChain、Axios、Vue、Pinia、Vue Router、shadcn-vue 和 Sonner。

## 本地依赖和文档依据

| 依赖      | 本地版本                                                                   | 使用方式                                                                              |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| NestJS    | `@nestjs/common` 12.2.0、`@nestjs/core` 12.2.0                             | 领域 Module、Controller、Provider、全局 JWT Guard、`@CurrentUser()`、参数 Schema Pipe |
| MikroORM  | `@mikro-orm/core` / `postgresql` 7.2.5、`@mikro-orm/nestjs` 7.1.0          | Entity/Repository、事务、行锁、PostgreSQL Migration                                   |
| Zod       | 4.6.7                                                                      | 请求与工具参数的 `z.strictObject`、schema 派生类型和解析                              |
| LangChain | `@langchain/core` 1.3.x、`@langchain/langgraph` 1.5.x                      | `tool()`、工具 schema、逐请求图的工具执行与 trace                                     |
| 前端      | Vue 3.5、Vue Router 4、Axios 1.20、Pinia 4、shadcn-vue 2.8、`vue-sonner` 2 | 页面/API 适配器、表单弹框、Toast                                                      |

主要参考：

- 仓库已有 `apps/api/src/orders/`、`apps/api/src/chat-purchase/`、`apps/api/src/user-preferences/` 与 `apps/api/src/chat-records/` 实现，优先复用其项目内约定。
- NestJS 官方模块与测试文档：<https://docs.nestjs.com/modules>、<https://docs.nestjs.com/fundamentals/testing>。
- MikroORM 7.2.5 官方 Entity、事务及 Migration 文档：<https://mikro-orm.io/docs/defining-entities>、<https://mikro-orm.io/docs/transactions>、<https://mikro-orm.io/docs/migrations>。
- Zod 4.6.7 官方 schema 与对象 API：<https://zod.dev/api>、<https://zod.dev/basics>。
- LangChain 工具执行沿用本地 `apps/api/src/llm/graph/llm.graph.ts` 与 `apps/api/src/chat-purchase/tool/purchase-tools.ts`，不另造工具执行框架。

## 包与目录结构

```text
apps/api/src/
├── user-addresses/
│   ├── index.ts
│   ├── user-addresses.module.ts
│   ├── controller/
│   │   └── user-addresses.controller.ts
│   ├── dto/
│   │   ├── user-address.schema.ts
│   │   └── user-address-response.dto.ts
│   ├── entity/
│   │   └── user-address.entity.ts
│   ├── service/
│   │   └── user-addresses.service.ts
│   ├── tool/
│   │   └── list-shipping-addresses.tool.ts
│   └── spec/
│       ├── user-addresses.service.spec.ts
│       ├── user-addresses.http.spec.ts
│       └── user-addresses.postgres.spec.ts
├── orders/tool/
│   └── list-user-orders.tool.ts
├── chat-purchase/tool/
│   └── select-shipping-address.tool.ts
└── chat-records/trace/
    └── chat-trace-writer.service.ts

apps/web/src/
├── api/modules/user-addresses.ts
├── api/types/user-addresses.ts
└── pages/account/addresses/
    ├── index.vue
    ├── page.ts
    └── components/
        ├── AddressFormDialog.vue
        └── AddressList.vue
```

`UserAddressesModule` 独立持有地址数据和 CRUD。`OrdersModule` 仅公开本人订单摘要查询工具工厂，地址簿不反向依赖订单。`ChatPurchaseModule` 负责将服务端选中的地址投影写入本人草稿。`ChatRecordsModule` 导入公开模块并为每次聊天组装工具；不把订单或地址数据库访问写进通用 `LlmModule`。

前端路由拟新增 `/account/addresses`（`account-addresses`），纳入现有账号布局和导航。地址列表/表单使用页面私有组件；操作成功或失败用现有 Toast，创建/编辑使用 shadcn-vue Dialog。

## Entity 与 Migration

建议 `user_addresses` 表字段：

| 列                          | PostgreSQL 类型 | 约束/索引                                               |
| --------------------------- | --------------- | ------------------------------------------------------- |
| `id`                        | `uuid`          | 主键，服务端生成                                        |
| `user_id`                   | `uuid`          | 非空，外键指向 `users.id`，索引                         |
| `recipient_name`            | `varchar(100)`  | 非空                                                    |
| `phone`                     | `varchar(21)`   | 非空                                                    |
| `address`                   | `varchar(500)`  | 非空，单一完整地址文本，与订单 `recipient.address` 兼容 |
| `label`                     | `varchar(40)`   | 可空，管理页面可读写                                    |
| `is_default`                | `boolean`       | 非空，默认 `false`                                      |
| `create_request_key`        | `uuid`          | 非空；与 `user_id` 组成唯一约束，用于新增请求幂等       |
| `created_at` / `updated_at` | `timestamptz`   | 非空，由服务端维护                                      |

默认地址最多一条，通过 PostgreSQL 部分唯一索引 `UNIQUE (user_id) WHERE is_default = true` 兜底；地址簿允许暂时没有默认地址。首条不自动设默认，新增/编辑表单由用户明确选择。已有订单没有地址簿关联，不需要数据回填。

Migration 采用增量迁移、保留现有用户/订单，`ON DELETE` 策略须遵守用户生命周期。当前用户模块没有物理删除 API，建议 `RESTRICT` 并要求未来账号删除流程先清理用户地址；对 disabled 用户保留地址。部分索引 SQL 和回滚影响在实施阶段审查。不得使用 `migration:fresh` 验证。

> 以上列长度、首条默认行为和外键删除策略是技术推荐，仍需在本技术文档审批时确认。

## Module 与依赖注入

- `UserAddressesModule` 注册 `UserAddress` Repository、`UserAddressesController`、`UserAddressesService`，导出 Service 与只读工具工厂所需的公开入口，不导出 Repository/Entity 供其他模块直接查询。
- Controller 使用 `@CurrentUser()` 获取用户并将 `user.id` 传给 Service；路径和 Body 都不包含归属用户。
- 普通 CRUD 路由统一拟采用 `/users/me/addresses`，符合已有 `/users/me` 风格。
- `OrdersModule` 内工具工厂使用公开 `OrdersService.listForUser()`，不得查询 Entity Repository 或调用管理列表。
- `ChatPurchaseModule` 以 `UserAddressesService.getForUser(userId, addressId)` 校验所有权，并向 `PurchaseDraftService` 更新当前会话草稿；不把 Address Entity 传出模块。
- `ChatRecordsService.tools(prepared)` 使用 `prepared.persistedConversation.userId` 和会话 ID 创建工具。图每次请求独立组装，闭包绑定账号；绝不把 userId 放在模型工具 schema。
- `AppModule` 注册地址模块；`ChatRecordsModule` 导入 `OrdersModule` 与 `UserAddressesModule` 以完成逐请求组合。模块依赖单向为 `chat-records -> chat-purchase/orders/user-addresses`，`chat-purchase -> user-addresses`。

## API 与请求 Schema

所有 HTTP DTO/schema 放在 `user-addresses/dto/`，参数由全局 `StandardSchemaValidationPipe` 解析；Swagger DTO 仅生成文档，不做运行时校验。Controller 不手动校验或查询 Repository。

### Schema 提案

`addressIdSchema`（Param）：

```ts
z.strictObject({ id: z.uuid() });
```

`listUserAddressesQuerySchema`（Query）：

```ts
z.strictObject({
  page: z.coerce.number().int().safe().min(1).default(1),
  pageSize: z.coerce.number().int().safe().min(1).max(100).default(20),
}).transform((value) => Object.assign(new UserAddressQueryDto(), value));
```

`createUserAddressSchema`（Body）：

```ts
z.strictObject({
  requestKey: z.uuid(),
  recipientName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\u0000-\u001f\u007f]*$/u),
  phone: z
    .string()
    .trim()
    .regex(/^\+?\d{6,20}$/u),
  address: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^[^\u0000-\u001f\u007f]*$/u),
  label: z.string().trim().min(1).max(40).nullable().optional(),
  isDefault: z.boolean().default(false),
});
```

`updateUserAddressSchema`（Body）：

```ts
z.strictObject({
  recipientName: recipientNameSchema.optional(),
  phone: phoneSchema.optional(),
  address: addressSchema.optional(),
  label: z.string().trim().min(1).max(40).nullable().optional(),
  isDefault: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);
```

- `z.input<typeof schema>` 用于描述有默认值/Query 转换前的外部输入；服务层参数和 DTO 返回使用 `z.output<typeof schema>`。
- Query `page`、`pageSize` 接受 URL 字符串并转换为安全正整数；默认 `1`、`20`，最大 `pageSize=100`。
- Body 数字字段不做字符串 coercion。未知字段一律 400；`userId`、审计时间和服务端拥有的字段不在 schema 中。
- `POST` 必须提供客户端为本次新增生成的 UUID `requestKey`；服务端持久化该键并建立 `(user_id, create_request_key)` 唯一约束。同一用户以相同键和相同规范化字段重试时返回原地址；相同键对应不同字段时返回 409。
- PATCH 省略字段表示不修改；`label: null` 清除标签；姓名/电话/地址不接受 null。空 PATCH 返回 400。
- 所有失败由 Nest `StandardSchemaValidationPipe` 映射为 HTTP 400。HTTP 测试需实测 param/query/body 的解析结果及未知字段行为。

| 操作           | Controller 绑定                                                      |
| -------------- | -------------------------------------------------------------------- |
| 列表           | `@Query({ schema: listUserAddressesQuerySchema })`                   |
| 详情/更新/删除 | `@Param({ schema: addressIdSchema })`                                |
| 新增/更新      | `@Body({ schema: createUserAddressSchema/updateUserAddressSchema })` |

### API 响应

本人地址 DTO 返回 `id`、`recipientName`、`phone`、`address`、`label`、`isDefault`、`createdAt`、`updatedAt`，不返回 Entity 或 `userId`。列表使用 `{ items, total, page, pageSize }`，排序为默认地址优先，其余 `updatedAt DESC, id DESC`。

| 方法与路由                           | 行为                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| `GET /api/users/me/addresses`        | 本人分页列表                                          |
| `GET /api/users/me/addresses/:id`    | 本人详情                                              |
| `POST /api/users/me/addresses`       | 携带 UUID `requestKey` 新增；同键同内容重试返回原地址 |
| `PATCH /api/users/me/addresses/:id`  | 更新本人字段/默认状态                                 |
| `DELETE /api/users/me/addresses/:id` | 删除本人记录，204                                     |

他人 ID 与不存在 ID 均返回 404。默认地址取消/删除后允许用户没有默认地址，不自动挑选其他记录。

## LLM 工具契约和流程

工具使用 `@langchain/core/tools` 的 `tool()` 与 Zod strict schema；工具函数工厂放在所属业务模块，并由 `ChatRecordsService` 逐请求组合。

截至 2026-11-13，地址查询已并入 `get_my_information`；下方 `list_my_shipping_addresses` 与 `select_my_shipping_address` 是旧实现说明，不再注册为模型工具。地址卡选择改由本人认证购买 API 执行，当前请求/投影契约见[用户信息查询 CRUD 契约](../../contracts/chat-user-information-crud-contract.md)。

### `list_my_orders`

- Query schema 仅允许可选 `orderNo`、`status`、`page`；`page` 正整数 1–10。
- 不接受 `userId`、`pageSize`、任意 SQL/排序表达式或时间范围。
- 固定调用 `OrdersService.listForUser(boundUserId, { page, pageSize: 5, status, orderNo })`，每次最多返回 5 条摘要。
- 二次白名单仅返回 `orderNo`、`status`、`closeReason`、`itemsAmount`、`payableAmount`、`itemCount`、`createdAt`、`paidAt`、`shippedAt`、`completedAt` 和商品名称/颜色/尺码/数量摘要。
- 明确剔除 `id`、`userId`、`recipient`、`shipment.trackingNo`、付款凭证及内部字段；如果订单被唯一定位，仍不返回完整订单详情。
- 普通用户及管理员都只能查询当前登录账号的订单。管理列表不能作为此工具的数据源。

### `list_my_shipping_addresses`（旧工具，已停用）

- Query schema 为 `z.strictObject({ page: pageSchema })`，默认第 1 页，最多 10 页；每页固定 20 条。
- 从绑定的 `UserAddressesService.listForUser(userId, query)` 读取。
- 返回最多 20 条 `{ addressId, isDefault, displayName }`，其中 `displayName` 由服务端生成“默认地址”或“地址 N”，不返回用户自定义标签，避免自由文本意外包含手机号/地址。
- 地址具体值只在账号 UI 和本人购买确认卡出现。

### `select_my_shipping_address`（旧工具，已停用）

- 工具参数严格为 `addressId`、`draftId`、`expectedVersion`；没有用户 ID 和收货字段。
- 从服务端绑定的 userId、conversationId 读取本人地址与本人当前草稿；二者所有权、会话关联、状态、版本都必须匹配。
- 服务端把地址记录当前值映射到草稿 `recipient.name/phone/address`，调用既有 `PurchaseDraftService.patch()` 与版本检查。地址 ID 由工具结果和会话上下文关联，不信任模型提供的地址字段。
- 工具结果只返回 `{ ok, draftId, version, filled: { name, phone, address } }`；不回传 PII。
- 成功写入草稿后，既有购买投影在本人 UI 展示确认内容，后续下单仍要求用户显式点击确认。

### 购买对话新增地址

- 模型可以询问字段并通过已有 `update_purchase_draft` 工具更新当前草稿；其工具结果仍使用安全投影。
- 用户主动发送的原始聊天消息按既有规则存储、进入模型上下文和 trace；本功能不声称消除这条现存数据路径。
- 如果用户选择将本次地址保存进地址簿，前端在本人购买 Dialog 中显示结构化地址预览和“保存地址/仅本次使用”命令。
- “保存地址”使用身份认证 CRUD API；输入只从本人服务端草稿投影填充，用户可在提交前编辑。每次新增由客户端生成 UUID `requestKey`；网络结果未知时始终使用原键重试。
- 模型工具不能直接写地址簿；模型生成的自然语言和任意 JSON 不构成确认卡或保存成功凭据。
- 地址保存失败时显示 Toast，保留草稿数据；地址簿保存成功但响应丢失时，以原 `requestKey` 重试并取得已保存地址，不重复创建。

地址簿创建记录与购买草稿更新分别提交，不做跨模块事务。地址创建重试命中原记录后，服务端返回权威地址 DTO，客户端再按现有购买草稿流程继续更新；不得以新键盲目重建地址。

## 事务、默认地址与并发

- 普通地址字段更新用 MikroORM Repository/EntityManager；跨多行变更使用 `transactional()`。
- 设置默认地址时，先锁定当前用户数据库行，再清除本人旧默认并设置目标地址；在同一事务中完成，并以部分唯一索引作最终不变量保护。
- 并发设默认或重复提交的唯一约束冲突经现有 `DbExceptionFilter` 映射 409；不得把地址写一半。
- 地址创建以 `(user_id, create_request_key)` 唯一约束防止重复插入；冲突时读取并比较规范化内容，相同则返回原记录，不同则返回 409。
- 删除和编辑均查询 `{ id, userId }`，不会先以全局 ID 查询后再判断归属。
- 地址选入草稿时先校验草稿会话归属和版本，再读取本人地址，并在草稿事务中保存地址快照字段。地址簿创建与该草稿更新不共享事务；创建成功但后续草稿更新失败时可安全重试草稿更新。地址随后修改/删除不改变草稿当时复制的数据；再次选择则复制新值。
- 正式订单创建仍由既有订单确认端口完成。地址簿与订单只靠快照解耦，不引入订单行到地址簿的外键。

## Trace、安全与数据生命周期

- `chat-records/trace/chat-trace-writer.service.ts` 对 `list_my_orders`、`list_my_shipping_addresses`、`select_my_shipping_address` 及地址输入类工具添加专属 whitelist projection；禁止在通用 `redactValue` 下只依靠 key 名猜测 PII。
- 工具参数 trace 只保留地址 ID、草稿 ID、版本和筛选条件；结果 trace 只保留状态、数量、地址引用、订单号/状态等摘要，绝不记录姓名、电话、地址和自定义标签。
- SSE `tool-call`/`tool-result` activity 也使用安全展示对象，不把完整参数/工具结果写入浏览器事件。
- `get_purchase_draft`、`update_purchase_draft` 现有工具安全投影及记忆提取隔离保持兼容。
- 日志只记录工具名、成功/失败分类与耗时，不记录完整输入、输出或用户标识；未知异常仍走现有安全映射。
- 地址不进入 `UserMemory`、偏好 Markdown、聊天摘要或新会话默认值。禁用账号地址保留且禁止访问。删除地址后从实时数据库移除；历史订单快照保留。当前没有物理删除账号/备份清理配置，因此不得承诺备份即时擦除。
- 删除默认地址不自动转移默认状态；用户可以没有默认地址。地址数据级联删除策略与后续账号删除流程需在迁移审查时验证。

## 前端技术边界

- 在 `pages/account/addresses/` 实现列表、空状态、新增/编辑 Dialog、删除确认和默认地址操作。
- API 只封装在 `api/modules/user-addresses.ts`；请求/响应类型唯一维护于 `api/types/user-addresses.ts` 并从 API types index 导出。
- 页面状态放 `page.ts`，覆盖 `idle/loading/success/empty/error` 和提交状态；支持 AbortController、过期响应保护与请求防重。
- 复用 shadcn-vue Button、Input、Textarea、Dialog、AlertDialog、Table 等本地 UI 组件及 Lucide 图标；成功/失败使用 Sonner Toast。
- “我的地址”进入既有 account 子路由。页面卸载清理请求；账号切换/退出时清空局部草稿与查询结果。
- 购买对话地址引用仍由聊天会话绑定，不用 Pinia 存储敏感数据；已保存地址不复制进跨会话前端 Store。

## 测试方案

### 后端

- Schema 单元测试：UUID、电话、姓名/地址/标签长度、控制字符、PATCH 空对象、null 语义、Query 默认/转换、未知字段拒绝及 input/output 类型行为。
- Nest HTTP 测试：未登录 401、普通/管理员本人 CRUD、越权与不存在均 404、禁用账号、Body/Query/Param 400 映射和安全响应 DTO。
- Service 单元测试：分页/排序、默认切换、删除默认后无默认、更新字段语义、重复地址策略和错误映射。
- PostgreSQL 测试：Migration、用户 FK、部分唯一索引、默认地址并发、地址所有权竞争、同键同内容幂等重试、同键异内容冲突、删除后订单快照不变。
- LLM tool 测试：无 userId schema、查询只调用本人 service、订单数量上限、白名单剔除 recipient/shipment、地址工具不回传 PII、越权 addressId 无泄漏。
- Trace 测试：工具 call/result 的参数、数据库 payload、SSE activity 和失败事件都不包含真实 fixture 中的姓名、手机号、地址或 label。
- Chat Purchase 集成测试：选地址复制当前值、旧版本 409、仅本次使用不落地址簿、显式确认保存、重复保存同一幂等键不生成第二条地址、未知结果通过同键重试恢复。

### 前端

当前仓库未安装 Vitest、Vue Test Utils 或 Playwright，不在本模块中擅自引入测试框架。实施阶段运行 `vue-tsc`、构建和 `pnpm check`，并记录未执行组件/浏览器自动化的验证缺口；可做经认证的手工地址管理和购买选择 Smoke Test。

### Migration 测试隔离

PostgreSQL 测试必须使用唯一、具名可销毁数据库及模块专属 `RUN_*_POSTGRES_TEST=1` 开关；启动前验证数据库名允许前缀，测试后只清理本次创建的专用数据库。默认开发数据库不迁移、不清空、不写测试数据。

## 验证命令

实现阶段至少运行：

```bash
pnpm exec prettier --check <changed-files>
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm check
```

Migration 和真实 HTTP/LLM 工具 smoke test 使用本技术方案的隔离数据库及测试账号；真实模型或外部生产密钥不纳入自动化测试。

## 审批问题与下一阶段

以下技术建议需用户审批；如果不同意，先修改设计/契约并重新确认，不直接开始实现：

- [x] 地址 API 使用 `/api/users/me/addresses`，路由名 `account-addresses`，标签页位于账号导航。
- [x] 地址用单一 `address` 字符串；姓名 100、电话 6–20 位数字、地址 500、标签 40 字符；地址列表分页默认 20、最大 100。
- [x] 首条地址不默认；允许无默认；删除默认后不自动选择；PostgreSQL 部分唯一索引确保最多一个默认。
- [x] 地址工具按 ID 生成“默认地址/地址 N”引用，不向模型暴露自由文本标签。
- [x] 订单工具复用 `OrdersService.listForUser()`，一次最多 5 条，仅返回订单/商品摘要，不含完整 recipient、物流单号或内部 ID。
- [x] 新地址保存只由用户按钮触发；每次新增使用 UUID `requestKey`，同用户同键同内容返回原地址、同键不同内容返回 409；不提供模型地址写工具。
- [x] 地址簿保存与购买草稿更新分开提交，不做跨模块事务；地址创建成功后使用返回的服务端地址结果继续更新草稿。

设计、CRUD 契约、本文技术方案和实施文档均已于 2026-11-10 确认。核心实现和自动化验证已完成；剩余环境门控验证记录在[实施文档](./user-addresses-implementation.md)中。
