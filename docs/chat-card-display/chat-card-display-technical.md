# 聊天通用卡片展示技术文档

## 状态与关联

- 状态：技术文档和实施文档均已由用户确认；功能已实现，验证结果见[实施记录](./chat-card-display-implementation.md)。
- 所属模块：`apps/api/src/chat-records`、`apps/api/src/product-catalog`、`apps/api/src/orders`、`apps/web/src/pages/chat`。
- 设计文档：[聊天通用卡片展示设计](./chat-card-display-design.md)。
- CRUD 契约：[聊天卡片展示 CRUD 契约](../contracts/chat-card-display-crud-contract.md)。
- 最后更新：2026-11-12。

技术方案已确认并实现。商品、订单、购买和取消的既有权限规则保持不变。

## 技术目标与原则

- 助手通过 `display_chat_card` 工具请求展示卡片；工具输出 JSON 协议对象 `{ "type": "card", "name": "...", "data": {} }`。
- 服务端校验工具输出及数据来源，再把卡片作为独立结构化展示数据送给前端；不从 assistant Markdown 正文、代码块或客户端历史内容中扫描 JSON。
- 聊天 Markdown 展示层接收卡片 JSON，校验协议并按本地注册的 `name` 选择 Vue 模板。未知模板不动态加载、不作为业务卡片执行。
- 领域查询工具继续负责取数。卡片工具只引用本轮领域工具已返回的条目，并由服务端从已校验来源重建 `data`，不接受模型编写的业务事实字段。
- 复用现有 LangChain、Zod、SSE、聊天展示投影与 Vue Markdown 能力；预计不增加依赖、HTTP API、数据库 Entity 或 Migration。

## 现有基础与依赖

| 能力          | 当前实现                                                                                      | 方案                                                                               |
| ------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 模型工具创建  | `ChatRecordsService.tools(prepared)` 组装本轮工具；工具使用 `@langchain/core/tools`           | 在聊天记录模块注册本轮卡片展示工具，并沿用 Zod 严格 schema                         |
| 商品来源      | `createProductSearchTool` 返回最多 3 个商品及公开字段                                         | 为本轮来源记录提供安全结果回调；只允许引用已返回的 `externalId`                    |
| 订单来源      | `createListUserOrdersTool` 绑定服务端当前用户并返回白名单摘要                                 | 记录安全订单摘要；卡片只能引用该用户本轮已查询的订单                               |
| 流式展示      | `ChatRecordsService` 消费 LLM 事件，`ChatDisplayService.apply` 生成白名单展示事件             | 卡片工具结果由 `ChatDisplayService` 校验并转成专用 SSE 事件                        |
| 历史恢复      | `publicDisplay` 与 assistant 消息 ID 绑定后写入模型 trace payload                             | 将卡片纳入同一投影、字节预算、事务绑定和历史恢复链路                               |
| Markdown 渲染 | `MarkdownRenderer.vue` 使用 `@crazydos/vue-markdown`，本地版本支持 Unified 插件与 scoped slot | 保留基础 Markdown renderer；由聊天专属 Markdown 展示组件处理卡片 JSON 和模板注册表 |

`@crazydos/vue-markdown` 的本地文档说明可通过 scoped slot 定制 Markdown 标签，但该能力不负责验证业务 JSON。卡片协议应在聊天展示组件中以显式数据输入处理，不为此关闭 HTML sanitize，也不启用 `rehype-raw`。

## 包和目录结构

实施时预计在现有边界内增量修改以下位置：

```text
apps/api/src/chat-records/
  display/
    chat-display.types.ts
    chat-display.projection.ts
    chat-display.service.ts
    chat-card-display.tool.ts
  service/chat-records.service.ts
  spec/chat-display.service.spec.ts
  spec/chat-records.service.spec.ts

apps/api/src/product-catalog/tool/
  product-search.tool.ts

apps/api/src/orders/tool/
  list-user-orders.tool.ts

apps/web/src/api/
  types/chat.ts
  modules/chat.ts

apps/web/src/pages/chat/
  components/
    ChatAssistantMessage.vue
    ChatMarkdownRenderer.vue
    ChatCardTemplate.vue
    cards/
      ChatProductCardList.vue
      ChatOrderCardList.vue
  ...
```

目录仅为职责建议；实施前按最终确认的所有权调整。订单和商品卡模板留在聊天页面私有组件内；基础 Markdown 组件保持通用，不引用后端模型或页面状态。

## 卡片协议与来源校验

### 工具输入与输出

工具名为 `display_chat_card`，每次调用生成一个卡片对象：

```json
{
  "type": "card",
  "name": "product",
  "data": {
    "items": []
  }
}
```

工具输入只含模板名及来源引用，不含任意可渲染 `data`。首批模板为：

- `product`：接收商品 `externalId` 列表；数量最多 5。服务端从本轮商品搜索结果中按 ID 取回规范商品投影，复用现有 `ChatProductCard` 字段。
- `order`：接收订单号列表；数量最多 5。服务端从本轮当前用户订单查询结果中按订单号取回安全订单摘要，复用 `list_my_orders` 的公开摘要字段。

工具输出的 `data` 由服务端生成。订单卡只读，字段不含收件人、手机号、详细地址、物流单号、支付凭据、`userId` 或内部 Entity 字段。既有 `productResults`、`orderCancellationCandidates`、`purchase` 展示结构继续保留，不迁移或删除。

所有工具输入对象使用 `z.strictObject`，引用列表拒绝空值、重复项、未知项和超限项。工具不接受 `userId`、`conversationId`、价格、库存、订单状态、取消标记或操作指令。调用方身份及会话从服务端准备上下文闭包读取。

### 本轮来源登记

建议为每次 `PreparedChat` 创建隔离的来源登记器，并将其分别注入商品搜索工具、订单查询工具和卡片展示工具：

1. 商品/订单工具完成领域查询后，将自身已白名单化的结果登记到本轮来源登记器，再返回给模型。
2. 卡片工具仅接受登记结果中存在的 ID/订单号；根据登记结果生成新的卡片 JSON，不透传模型提交的对象字段。
3. 展示层再次使用 `ChatDisplayService` 的服务端 schema 校验和公开投影。来源缺失、跨轮引用、工具失败或字段不合法时，不产生卡片。
4. 登记器跟随单次聊天调用销毁，不写入全局状态、trace 或日志。

来源登记采用回调/窄接口，不让商品或订单模块反向依赖 `chat-records`。若实现调查发现现有工具 API 不适合增加回调，应在实施文档中给出同等隔离的适配方式，不能改成接受任意模型 JSON。

## 服务端流程、SSE 与历史

1. `ChatRecordsService.tools(prepared)` 创建本轮来源登记器，装配已有领域工具和 `display_chat_card`。
2. 卡片工具返回 JSON 字符串供模型工具循环使用；服务端来源登记器保留该工具物化的规范卡片。LLM 流中的 `tool-result` 仍由 `ChatDisplayService.apply` 解析并重新校验，不以模型正文或客户端传入值为准。
3. 流式接口校验通过后，把卡片追加到当前 `ChatDisplayData.cards`，检查现有 `MAX_DISPLAY_BYTES` 总预算，再生成 SSE `card` 事件。未通过的数据不推送给浏览器。
4. 同步聊天接口在模型调用完成后，从同一请求级来源登记器读取卡片，并通过相同投影/schema 和预算校验后加入响应及历史快照；不能因同步接口缺少流事件循环而丢失卡片。
5. 实时事件形态为 `event: card`，数据体为 `{ "card": { "type": "card", "name": "...", "data": {} } }`。既有 `delta`、`activity`、`done`、`error` 语义和顺序保持不变。
6. 最终消息保存沿用现有 `persistChat` 事务：卡片放入 `publicDisplay.cards`，仍通过 `assistantMessageId` 绑定到最终模型 trace。历史读取只从该绑定的 `publicDisplay` 使用同一 schema 和投影恢复卡片，不从工具 trace 重建卡片。
7. `cards` 在旧 envelope 缺失时默认为空数组；无效或未知卡片按整张卡片丢弃，普通正文与其他有效展示字段继续可读。新增字段纳入现有 16 KiB 展示 envelope 和 32 KiB trace payload 预算，不新增独立持久化表。

一个卡片最多 5 个条目；卡片集合与既有 `publicDisplay` 共用 16 KiB 上限。预算溢出时拒绝新增卡片并将工具展示标为不可用，不截断价格、库存或订单状态等字段。

## 前端解析与模板分发

- `ChatStreamEvent` 增加有类型的 `card` 事件；`parseEventFrame` 对事件载荷做运行时校验。历史 `ChatApiMessage` 增加可选 `cards`，历史映射对缺失或不合法数据安全回退为空数组。
- `ChatMessage` 只保存已验证卡片的规范类型；流式事件 reducer 和 `toChatMessage` 共用相同字段语义，避免实时和历史展示不一致。
- 新增聊天专属 `ChatMarkdownRenderer`，输入 assistant Markdown 和卡片 JSON。卡片在 Markdown 正文之后按工具调用顺序显示；组件只识别 `type === "card"`，并通过固定 registry 将 `product`、`order` 映射到本地模板组件。
- 模板使用显式 `defineProps` / `defineEmits`。商品购买、翻页和订单查看等交互经 Emits 返回 `ChatAssistantMessage`，继续调用当前页面既有处理函数；卡片 JSON 本身不执行操作。
- 初版订单模板只读；若后续加入操作，须另行更新设计与契约，并复用现有组件、当前用户服务端授权、状态复核和用户确认流程。
- 未识别 `name`、schema 不匹配或旧历史缺字段时不渲染卡片；其余 Markdown、来源和现有结构化展示保持可读。不得将卡片 JSON 直接传给 `v-html`。

## 状态与错误处理

| 情况                               | 处理                                                      |
| ---------------------------------- | --------------------------------------------------------- |
| 工具引用不存在或不属于本轮结果     | 工具返回无效引用错误；不产生卡片 SSE 或历史投影           |
| 工具结果 JSON 非法或 schema 不匹配 | 服务端拒绝卡片；保留安全工具 activity，不回显原始工具输出 |
| 未注册的 `name`                    | 服务端拒绝；前端也不动态加载，历史中仅忽略该卡片          |
| 展示预算超限                       | 拒绝新增卡片，不截断字段；其他正文继续展示                |
| 旧消息缺少 `cards`                 | 解析为空数组，正文正常显示                                |
| 历史卡片损坏                       | 丢弃无效卡片，不影响其他有效卡片或消息内容                |
| SSE 卡片事件格式错误               | 按现有聊天流协议错误处理，不将未知 JSON 合并进消息状态    |

公开错误不包含原始工具参数、用户订单资料、对象键、密钥或内部异常。被拒绝的原始卡片不写入活动、trace 展示投影或日志。

## 请求 Schema、校验和错误映射

本方案不新增 HTTP Body、Query 或路由参数，因此没有新的 Controller 参数或 Nest `StandardSchemaValidationPipe` 绑定。模型工具输入属于 LangChain 工具边界，使用 Zod 4 schema 校验：

| Schema                      | 建议位置                                          | 核心规则                                                                                   |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `displayChatCardToolSchema` | `chat-records/display/chat-card-display.tool.ts`  | `z.strictObject`；`name` 为允许的模板枚举；引用数组非空、去重并限制最多 5 个；拒绝未知字段 |
| `productCardDataSchema`     | `chat-records/display/chat-display.projection.ts` | 从已登记商品结果生成；复用商品卡字段约束；拒绝额外字段及非公开 URL                         |
| `orderCardDataSchema`       | `chat-records/display/chat-display.projection.ts` | 订单摘要字段严格白名单；只读状态字段；拒绝个人地址和内部字段                               |
| `cardEnvelopeSchema`        | `chat-records/display/chat-display.projection.ts` | `type: z.literal("card")`；有限 `name`；按名称分发对应 `data` schema                       |

输入类型由 schema 推导；工具输入与服务端物化后的卡片输出分别定义类型，不复用 Entity、工具原始输出或前端组件 Props 作为持久化类型。Zod 解析失败转换为安全的工具失败结果或卡片拒绝，不向模型/客户端输出解析器内部细节。

## 安全和可观测性

- 来源数据只在单次请求的闭包中流转；当前用户 ID 由服务端绑定，schema 不接受身份字段。
- 商品和订单使用明确字段白名单；商品链接只允许现有公开 URL 校验规则认可的 HTTP/HTTPS URL。
- 卡片 JSON 作为非可信输入处理，即便工具已返回也需服务端重新校验；前端再做运行时协议检查。
- `type` 和 `name` 仅选择展示模板，不作为授权、订单操作或用户确认凭据。
- 工具 activity 继续只公开已允许的状态字段，不回显卡片原始输出。LLM trace writer 为该工具的参数和结果增加专用安全投影：只允许卡片协议 schema 中的公开字段，非法结果只记录通用失败内容；禁止记录完整实体、联系方式、密钥、图片 Base64、对象键或签名 URL。
- 历史展示只从绑定到 assistant 消息的 `publicDisplay` 恢复；内部工具 trace 仅服务模型审计/上下文，不作为前端卡片来源。
- 前端 renderer 保持 `sanitize` 开启，不启用未经净化的 HTML 插件，不允许通过卡片数据提供组件名、组件路径、事件处理器或任意 URL scheme。
- 订单卡片首版只读；既有取消候选和购买流程继续使用当前独立的结构化服务端投影。

## 测试方案

### API

- 工具 schema 合法/非法边界、未知字段、重复引用、超限及跨来源引用拒绝。
- 商品和订单工具登记的来源可物化为白名单卡片；查询失败、未知 ID、工具失败和不同轮次的来源不可产生卡片。
- SSE 事件只包含投影后的卡片对象；损坏 JSON、未知模板和敏感字段不进入公开 activity、trace 或日志。
- Envelope 序列化/恢复、缺失 `cards` 的旧记录、损坏卡片、消息绑定冲突、字节预算和事务回滚。
- 端到端 API 流测试验证卡片事件与最终 assistant 消息绑定、历史恢复保持一致；PostgreSQL 用具名可销毁数据库并遵循现有 `RUN_*` 门控。

### Web

在前端测试基础设施获准落地前，不新增测试依赖或脚本。后续测试至少覆盖 SSE 卡片协议合法/非法载荷、历史旧字段回退、`type` 与 `name` 分发、未知模板降级、Markdown 安全过滤，以及商品模板 Emits 沿既有父组件事件链传递。

## 验证命令

实施阶段按项目约定执行并记录结果：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm check
```

前端当前没有已获准的单元、组件或浏览器测试脚本；命令通过不等同于卡片交互浏览器验收。实施阶段需另外记录真实 SSE/历史恢复 smoke test 与浏览器验收是否执行。

## 实施状态

代码已按本方案实现；构建、测试及未执行的集成和浏览器验证记录见[实施文档](./chat-card-display-implementation.md)。
