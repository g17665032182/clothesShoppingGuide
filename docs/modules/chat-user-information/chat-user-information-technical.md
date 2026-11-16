# 聊天用户信息查询技术文档

## 状态与依据

- 状态：设计、CRUD 契约、技术与实施文档均已确认；代码已实现，最终验证记录见[实施文档](./chat-user-information-implementation.md)。
- 依据：[用户信息查询设计](./chat-user-information-design.md)、[用户信息查询 CRUD 契约](../../contracts/chat-user-information-crud-contract.md)。
- 关联契约：[聊天卡片展示](../../contracts/chat-card-display-crud-contract.md)、[聊天动态表单](../../contracts/chat-dynamic-form-crud-contract.md)、[聊天购买](../../contracts/chat-purchase-crud-contract.md)、[用户地址](../../contracts/user-address-crud-contract.md)。
- 所属应用：`apps/api`、`apps/web`。
- 最后更新：2026-11-13。

## 技术决策

- 新增 `chat-user-information` 查询模块；不新增 Entity、Migration、运行时依赖或通用资料表。
- `get_my_information` 按请求动态创建，用户身份从 `ChatRecordsService` 的认证会话闭包绑定，不接入全局静态工具注册表。
- 地址、订单和图片由各自领域模块查询并生成字段白名单 DTO。用户信息模块不依赖 Entity/Repository，也不把任一领域响应原样序列化给模型。
- 地址选择卡使用现有 `card` SSE 与 `publicDisplay.cards` 历史投影，新增严格模板 `address_selection`，数据仅含 `{ draftId, draftVersion }`。
- 地址详情只由卡片组件使用当前认证身份调用本人地址 API 临时读取。点击选择改为购买模块的认证 HTTP 操作，不经过聊天消息或模型工具。
- 空地址簿分支复用现有 `request_dynamic_form` 和 `purchase_recipient` 处理器。地址查询成功、非空、为空和失败是不同状态，失败不能转换为空列表。
- LangGraph `ToolNode` 可并行处理同一轮的多个工具调用。地址卡和动态表单需共享请求级购买收件信息分支协调器，并以同一次地址查询结果裁决，不能只依赖模型按顺序调用工具。

## 本地依赖与现有能力

| 能力         | 本地实现                                              | 本方案                                                                        |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| 工具与运行图 | `@langchain/core` 1.3.x、`@langchain/langgraph` 1.5.x | 复用 `tool()`、逐请求工具闭包和现有 trace writer                              |
| Schema       | `zod` 4.6.x                                           | 工具与卡片协议使用严格 Zod schema                                             |
| 后端         | NestJS 12.2、MikroORM 7.2.5                           | 复用模块公开 Service、Controller、JWT Guard 和 `StandardSchemaValidationPipe` |
| 前端         | Vue 3.5、Axios 1.20、Pinia 4                          | 复用聊天卡片、认证 API adapter 和局部组件状态                                 |
| 动态表单     | `@formily/core`、`@formily/vue` 2.3.7                 | 复用现有受限字段映射和 `ChatDynamicFormCard.vue`                              |

优先复用以下已存在能力：

- `UserAddressesService.listForUser()` 提供本人地址列表；LLM 输出再次投影为安全引用。
- `OrdersService.listForUser()`、`getForUser()` 提供本人订单与商品明细来源；新工具只提取允许的摘要字段。
- `TryOnPhotoService.listSavedMetadataForUser()` 只读取 `saved` 且 `active` 图片，使用有界分页元数据查询且不返回对象存储信息。
- `PurchaseDraftService.patch()` 提供购买草稿所有权、会话、状态和版本校验；地址选择端点只接受地址 ID，不接受完整收件字段。
- `ChatDisplayService` 已有卡片 schema、预算、SSE、`publicDisplay` 绑定与历史恢复路径。
- `ChatDynamicFormService`、`PurchaseRecipientFormAdapter` 和 Formily 卡片继续负责空地址时的表单生命周期与提交。

## 模块与目录

```text
apps/api/src/chat-user-information/
  chat-user-information.module.ts
  dto/
    chat-user-information.schema.ts
    chat-user-information-response.ts
  service/
    chat-user-information.service.ts
  spec/
    chat-user-information.schema.spec.ts
    chat-user-information.service.spec.ts
    get-my-information.tool.spec.ts

apps/api/src/chat-records/
  tools/
    chat-user-information.tool.ts
  purchase-recipient/
    purchase-recipient-flow-coordinator.ts
  display/
    chat-display.types.ts
    chat-display.projection.ts
    chat-display.service.ts
  history/
    chat-history.mapper.ts
  trace/
    chat-trace-writer.service.ts
  service/
    chat-records.service.ts

apps/api/src/chat-purchase/
  controller/chat-purchase.controller.ts
  dto/chat-purchase.schema.ts
  service/purchase-draft.service.ts

apps/api/src/virtual-try-on/
  service/try-on-photo.service.ts

apps/web/src/
  api/modules/
    chat-purchase.ts
    user-addresses.ts
  api/types/
    chat-purchase.ts
    chat.ts
  pages/chat/
    components/
      ChatCardTemplate.vue
      ChatAssistantMessage.vue
      cards/ChatAddressSelectionCard.vue
```

具体文件按现有目录增量修改；不得搬动已实现模块或引入跨模块 Entity/Repository 依赖。

### Nest 模块边界

- `ChatUserInformationModule` 导入地址、订单和虚拟试穿模块，只调用其公开查询 Service；它不导入 `chat-records`、`chat-purchase` 或 `chat-dynamic-form`。
- `ChatRecordsModule` 导入 `ChatUserInformationModule`，按当前认证用户和会话创建 `get_my_information` 工具，并负责本轮展示及收件信息分支协调。
- `ChatPurchaseModule` 已导入 `UserAddressesModule`；新地址选择 Controller/应用方法留在购买模块，地址值由服务端读取并复制到草稿。
- `ChatDynamicFormModule` 保持独立。动态表单仍由聊天编排调用其公开 Service/工具，不反向依赖聊天展示模块。
- `VirtualTryOnModule` 通过 `TryOnPhotoService` 提供有界、安全的已保存图片元数据查询，不注入具有图片内容/试穿执行能力的 `CHAT_TRY_ON_PORT`。

## 用户信息工具

### 输入 Schema

`chat-user-information/dto/chat-user-information.schema.ts` 定义 `getMyInformationSchema`：

```ts
import { OrderStatus } from '../../orders/index.js';

z.strictObject({
  sections: z
    .array(z.enum(['addresses', 'orders', 'photos']))
    .min(1)
    .max(3)
    .refine((items) => new Set(items).size === items.length)
    .default(['addresses', 'orders', 'photos']),
  orderNo: z.string().trim().min(1).max(100).optional(),
  status: z
    .enum(Object.values(OrderStatus) as [OrderStatus, ...OrderStatus[]])
    .optional(),
  page: z.number().int().safe().min(1).max(10).default(1),
});
```

- 输入类型由 schema 推导；身份、会话、图片 ID、地址 ID 和业务动作不接受为模型参数。
- `orderNo`、`status` 仅在请求 `orders` section 时使用；schema/Service 拒绝与 section 不相容的筛选参数。
- 每个 section 固定最多 5 条。分页使用相同的 `page`，不接受模型提供 `pageSize`。
- `z.strictObject` 拒绝额外字段；LangChain 将 schema 错误转为安全工具错误，不返回 Zod 原始输入或异常。

### 查询编排和响应

`ChatUserInformationService.lookup(boundUserId, input)` 独立查询请求 section，并在每个 section 边界立即执行字段白名单投影。依赖故障按 section 隔离，部分成功不丢弃其他 section。

成功结构保持 CRUD 契约：

```json
{
  "ok": true,
  "sections": {
    "addresses": {
      "items": [],
      "page": 1,
      "pageSize": 5,
      "total": 0
    }
  },
  "errors": []
}
```

- 地址为空是成功响应中的 `total: 0`；不可用是 `errors` 中该 section 的固定 `unavailable` 状态。
- 地址结果只含 `addressId`、`isDefault`、系统生成的 `displayName`。
- 订单结果只含契约定义的订单号、状态、金额、时间和商品名称/颜色/尺码/数量；不得复制 `getForUser()` 中的 recipient、shipment 或其他详情字段。
- 图片使用分页查询，限定 `kind=saved`、`status=active`，结果只含 `photoId`、`kind`、MIME、字节数、尺寸、创建时间和 `availability`。不得返回 `objectKey`、URL、Buffer、Base64 或图片内容。
- 空结果正常返回 `ok: true`、空 `items` 与 `total: 0`。未知资源不用于探测其他用户；失败错误不含底层异常。

`chat-records/tools/chat-user-information.tool.ts` 只处理模型工具入口、服务调用和安全 JSON 结果。调用方闭包绑定 `userId`；该工具不执行写操作。

## 下单地址分支与并发

`ChatRecordsService.tools(prepared, display)` 创建每轮独立的 `PurchaseRecipientFlowCoordinator`，并将其窄接口提供给信息查询工具和 `request_dynamic_form` 工具适配层。

协调器对当前本人草稿执行最新状态读取，并只在草稿为 `collecting`/`ready` 且收件信息至少缺一个必填字段时启用。它对地址簿查询使用同一个请求级 Promise/结果，状态为：

| 查询结果                               | 聊天展示与表单行为                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有效草稿缺收件信息；地址查询成功且非空 | 从服务端当前草稿取得 `draftId`/`version`，stage 一个 `address_selection` 卡；`purchase_recipient` 表单请求拒绝并返回安全的 `address_selection_required` |
| 有效草稿缺收件信息；地址查询成功且为空 | 不 stage 地址卡；允许 `request_dynamic_form` 收集当前草稿实际缺失字段                                                                                   |
| 地址查询失败                           | 不 stage 选择卡、不按空列表开表单；向助手提供固定失败状态，以便告知重试或等待用户明确选择手动填写                                                       |
| 无有效购买草稿或收件信息已完整         | 不生成地址选择卡；禁止将其误当作空地址簿表单分支                                                                                                        |

工具节点可能并行执行。两个工具同时请求该分支时必须复用同一查询 Promise 和结果；表单创建在当前 run 内做 single-flight，避免重复创建。`request_dynamic_form` 只有在该共享结果为空，或当前用户明确表达手动填写意图且查询失败时，才可创建 `purchase_recipient` 表单。此授权来自当前用户输入，不接受模型工具参数自行声明。协调器每轮销毁，不保存完整地址列表或填写值。

`PurchaseRecipientFormAdapter.prepareForm()` 继续从服务端读取草稿及 SKU。除既有业务字段 allowlist 外，只生成草稿当前缺失的收件字段，不能重复要求填写已有值；提交仍只调用购买草稿更新能力。

## 地址选择卡与 HTTP 操作

### 卡片协议

在 `chat-records/display/chat-display.types.ts`、`chat-display.projection.ts` 与前端 `api/types/chat.ts` 增加：

```json
{
  "type": "card",
  "name": "address_selection",
  "data": {
    "draftId": "uuid",
    "draftVersion": 1
  }
}
```

- 服务端只从最新的本人购买草稿引用构造卡片；不接受模型传入的地址 ID、完整地址或草稿字段。
- 地址选择卡由 `get_my_information` 的服务端结果分支直接 stage，通过既有 `card` SSE 事件发送；不要求模型再调用 `display_chat_card` 才能显示。
- SSE 卡片和现有商品/订单卡共用 `publicDisplay.cards`、assistant 消息绑定、16 KiB envelope 预算及历史严格恢复；不新增事件种类或数据库字段。
- 地址详情不进入 SSE 卡片 payload、`publicDisplay`、Pinia 持久化、localStorage、模型上下文、tool activity 或 trace。

### 选择地址 API

在现有 `ChatPurchaseController` 增加：

```http
POST /api/chat/conversations/:conversationId/purchase-draft/:draftId/select-address
```

Body：

```ts
z.strictObject({
  addressId: z.uuid(),
  expectedVersion: z.number().int().safe().positive(),
});
```

- 路由参数复用/扩展 `purchaseDraftParamsSchema`，Query 绑定 `purchaseEmptyQuerySchema`，Body 绑定新的 `selectPurchaseAddressSchema`；未知字段返回 400。
- Controller 只取 `@CurrentUser()`、参数和 Body，委托购买模块应用逻辑。服务端用当前用户调用 `UserAddressesService.getForUser()`，再以 `{ userId, conversationId, draftId, expectedVersion }` 调用草稿版本保护写入；客户端不能传姓名、电话或地址。
- 成功响应使用现有 `PurchaseDraftDto` 安全投影，供本人购买 UI 刷新；敏感字段只经认证 HTTP 响应返回本人，不进入模型、trace、聊天历史或公开卡片。
- 未登录/禁用账号为 401；地址、会话或草稿不存在/不属于本人为 404；草稿版本或状态冲突为 409；schema 非法为 400。地址查询失败使用既有服务错误映射。
- 前端提交中禁止重复点击。结果未知或 409 时先重读本人草稿及地址列表，不用旧版本盲目重试；成功后刷新购买草稿投影并禁用旧卡片。

现有 `select_my_shipping_address` 不再注册为模型工具。旧 trace 仍走既有安全投影，历史工具调用与结果在 `chat-history.mapper.ts` 中成对过滤，不能重新回放为模型可执行操作。

## SSE、历史与前端

### 后端投影

- `ChatDisplayService` 对地址卡严格校验 `draftId`、正版本，并执行既有总字节预算校验。
- `ChatDisplayService.apply()` 将已 stage 的地址卡绑定到 `get_my_information` 的成功 tool result 并输出现有 `card` SSE event；未经服务端 stage 的同名卡片不能从模型结果或正文进入展示。
- 流式和非流式聊天均将卡片纳入同一 assistant 最终展示绑定；历史读取只从绑定的 `publicDisplay` 恢复。
- 旧历史缺少地址卡字段时按既有空卡片兼容；损坏/未知卡片只丢弃该卡，不影响正文。

### 模型上下文、trace 与 activity

- `get_my_information` 的本轮运行时结果使用安全摘要供模型回答；不得将完整地址、收件信息或图片内容放入模型上下文。
- `chat-history.mapper.ts` 将 `get_my_information` 加入隐藏工具集合，工具调用及结果必须配对过滤，避免地址/订单/图片元数据被作为普通聊天历史回放到后续模型轮次。
- `ChatTraceWriterService` 为 `get_my_information` 添加专属参数/结果投影：参数只保存 section、page 和允许的订单筛选摘要；结果只保存 section 状态、条数及安全错误码，不保存地址 ID 集合、photoId、地址/订单完整 DTO 或图片元数据。
- `select_my_shipping_address` 停止执行后仍保留旧 trace 白名单读取兼容；新 HTTP 选择动作不产生 LangGraph 工具 trace/activity。
- 普通 tool activity 继续只显示安全工具名称和状态，输入/输出为 null。日志只记工具名称、section 状态和耗时，不记完整用户资料。

### Web 卡片

- `ChatCardTemplate.vue` 固定映射 `address_selection` 到页面私有 `ChatAddressSelectionCard.vue`；未知模板不动态加载。
- 卡片仅凭 `draftId`、`draftVersion`，使用 `chat-purchase` API adapter 重新读取本人当前购买草稿，并通过 `user-addresses` adapter 分页读取本人地址。地址列表 DTO 只保存在卡片组件的局部内存，不写全局 Store 或浏览器持久化。
- 默认地址仅显示默认标记，初始无选中项；用户必须显式点击某一地址。
- 卡片处理 loading、empty、error、retry、submitting、stale 状态；请求使用 `AbortController` 和用户/会话/草稿版本守卫。卸载、切换账号/会话时取消请求并清空地址详情。
- 选中后由页面 action 调用新增 `selectPurchaseAddress()` API adapter，body 只提交 `addressId` 与 `expectedVersion`；不能调用 `chat.sendMessage()`。成功后刷新现有购买草稿；冲突时禁用旧引用并重新读取，用户可在新状态下再次选择。
- 历史卡片恢复时同样重新读取当前地址及草稿，不恢复历史地址详情；草稿不再可编辑、引用版本过期或地址接口不可用时禁用选择并提供重试/刷新。

## 测试方案

### API

- 工具 schema：合法 section、重复/未知 section、未知键、分页边界、筛选参数与 section 不相容及默认值。
- 信息投影：地址结果不含姓名/电话/地址/用户标签；订单结果不含收件信息、物流和内部 ID；图片结果不含 URL、对象键、签名 URL、Buffer 或 Base64。
- 查询编排：空地址簿是成功空结果；单 section 故障返回 `unavailable`；部分成功保留其他 section；服务异常不泄露到结果。
- 收件分支：非空地址只 stage 选择卡且拒绝动态表单；成功空列表允许动态表单；查询失败不按空结果开表单；无草稿/信息完整不生成地址卡或购买表单。
- 并发：同轮并发工具调用只使用一次地址查询，地址卡与购买表单互斥，同轮重复表单请求不会重复创建。
- 购买 API：未登录 401、严格 Body 400、地址或草稿越权统一 404、版本/状态过期 409；成功仅把服务端地址记录写进本人草稿。
- 投影与持久化：实时 SSE、同步响应、历史绑定和 envelope 预算；未 stage 卡片不能展示；旧地址工具历史调用不会回放。
- Trace/history：嵌套及普通 tool-call/tool-result 均按专属白名单处理；断言地址 ID 集合、photoId、完整订单/图片字段不进入 trace、activity、公开历史和后续模型历史。
- 试穿图片分页查询限定 saved/active，分页有界且排序稳定。

### Web

前端当前未获准新增 Vitest、Vue Test Utils 或 Playwright。至少执行 Web typecheck/build，并在实施验收中人工检查 SSE 与历史卡片。

- SSE/parser 和历史旧记录对 `address_selection` 的合法、非法、未知字段与缺失兼容。
- 默认地址不预选；本人 API loading/empty/error/retry；选择重复点击保护及 409/stale 刷新。
- 验证地址点击不调用 `chat.sendMessage()`、消息历史/Pinia/localStorage 中没有地址详情；会话/账号切换后请求取消、局部详情清空。
- 窄屏、键盘导航、屏幕阅读器可操作；卡片与购买确认仍由独立用户操作完成。

## 实施阶段验证命令

获准进入实施阶段后按仓库约定执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm check
git diff --check
```

本方案不新增数据库表或 Migration；如实现期间发现必须新增持久状态、授权边界或公开 API 行为，先回到设计/CRUD 契约阶段重新审批。数据库相关测试仍使用具名隔离库；`migration:fresh` 不用于功能验证。前端无自动化浏览器测试基础设施时，登录后交互必须标记为人工 Smoke 或未执行。
