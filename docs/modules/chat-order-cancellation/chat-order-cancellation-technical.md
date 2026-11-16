# 聊天订单取消技术文档

## 状态与目标

- 状态：已确认。
- 前置审批：用户已确认[设计文档](./chat-order-cancellation-design.md)和[聊天订单取消契约](../../contracts/chat-order-cancellation-crud-contract.md)。
- 实现状态：已完成，验证记录见[实施文档](./chat-order-cancellation-implementation.md)。
- 最后更新：2026-11-10。

在现有聊天、订单和展示模块中增加只读的可取消订单候选查询和可信订单卡片。最终取消继续调用本人订单 API；模型不获得订单写工具。本方案不新增运行时依赖、数据库表/字段、Migration 或公开 HTTP 路由。

## 现状与依赖

| 已核实能力                                                                                      | 技术方案                                                                                                        |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `orders` 有本人分页查询、详情、取消 Service 和安全摘要；取消在事务中按 SKU 再订单的既有顺序加锁 | 增加订单模块内部的可取消候选读取能力；取消写操作继续复用 `cancelForUser()`                                      |
| `list_my_orders` 通过服务端闭包绑定 `userId`，工具最多输出 5 笔安全摘要                         | 扩展只读工具结果，增加卡片所需的受限订单引用及支付截止时间；不接受身份参数                                      |
| 订单摘要已有 `id`、`expiresAt`，但现有订单工具投影未包含它们                                    | 只向当前模型运行中的工具结果传递；trace 继续使用独立白名单，避免直接持久化完整结果                              |
| 订单过期由每 5 秒批次轮询关闭；`listForUser()` 和 `getForUser()` 本身不关闭过期订单             | 候选查询必须用数据库时钟直接排除 `expires_at <= clock_timestamp()` 的记录；取消端点仍再次锁内检查               |
| `ChatDisplayService` 将商品结果转换为结构化 SSE，并绑定到 `PublicDisplayEnvelope`               | 增加结构化订单候选展示类型和 SSE 事件；历史恢复从可信展示信封读取                                               |
| `useChatOrder()` 已实现本人详情、取消请求、确认弹框、提交状态、409 重读和结果未知处理           | 卡片按钮复用既有动作状态和 `OrderActionDialog`；增加窄范围编排以直接打开取消确认，不复制订单状态机或 Axios 调用 |

依赖版本沿用现有 `@nestjs/common` 12.2、MikroORM 7.2.5、Zod 4、LangChain core/LangGraph、Vue 3.5、Pinia、Axios、shadcn-vue、Reka UI 和 Lucide。无须添加依赖。

## 所有权与目录

```text
apps/api/src/
  orders/
    service/orders.service.ts                 # 只读可取消订单查询；既有事务取消逻辑
    tool/list-user-orders.tool.ts             # 当前用户绑定、可取消筛选和安全投影
    spec/                                     # 查询边界、状态及工具输出测试
  chat-records/
    display/chat-display.types.ts             # 可信订单卡片和 SSE 事件类型
    display/chat-display.projection.ts        # 严格 schema、默认值与展示字节预算
    display/chat-display.service.ts            # 解析受控工具结果并生成结构化展示
    trace/chat-trace-writer.service.ts         # 订单工具结果持久化白名单
    service/chat-records.service.ts            # 同 assistant 消息事务绑定展示信封
  llm/
    context/system-context.md                 # 明确取消意图与模型只读边界
    context/after-sales-flow.md                # 待付款取消和未接入退款售后的区分

apps/web/src/
  api/types/chat.ts                            # 订单候选展示类型
  stores/chat/turn.ts                          # 接收候选 SSE 事件
  pages/chat/components/ChatAssistantMessage.vue
  components/shared/orders/useChatOrder.ts     # 复用订单动作状态和取消确认
  components/shared/orders/OrderActionDialog.vue
```

具体文件调整由后续实施文档分工确认；本阶段只确定职责和接口边界。`orders` 不依赖聊天模块，`chat-records` 只通过 `OrdersService` 公开方法读取订单，前端只依赖聊天公开类型和订单 API 模块。

## 订单候选查询

在 `OrdersService` 增加服务内部方法 `listCancelableForUser(userId, limit)`：

1. 使用 `orders` 模块自己的 EntityManager/Repository，不把订单 Entity 或 Repository 暴露到 `chat-records`。
2. 单次查询限制 `user_id = 当前账号`、`status = pending_payment`、`expires_at > clock_timestamp()`，按 `created_at DESC, id DESC` 排序并最多取 5 笔。
3. 批量读取对应 `OrderItem`，只映射订单卡片允许的字段；不加载或返回 recipient、shipment。
4. 返回 `{ id, orderNo, status, payableAmount, createdAt, expiresAt, items }` 的内部安全投影。
5. 该读取操作不持锁、不改变订单状态、不释放库存。若订单在读取后到期或状态变化，最终取消仍由 `cancelForUser()` 加锁并按数据库实际时钟验证。

这解决后台过期轮询的异步窗口：已过期但暂时仍存为 `pending_payment` 的行不会被标记为可取消。该读取结果只是瞬时候选，不构成取消承诺。查询与取消之间状态竞速由既有取消 Service 处理。

`list_my_orders` 工具保留常规订单查询行为；在明确取消意图且以待付款状态筛选时，使用 `listCancelableForUser()` 生成取消候选。工具 schema 仍使用严格 Zod 对象；`orderNo` 可选 trim 后 1–100 字符，`status` 为既有订单状态枚举，`page` 为 1–10 整数并默认 1。模型不能提交 `userId`、`orderId` 写操作、收货字段或状态转换参数。服务端继续绑定用户身份。

## 展示投影与 SSE

扩展 `ChatDisplayData`、`PublicDisplayEnvelope` 和前端 `ChatMessage`，新增 `orderCancellationCandidates`，每轮最多 5 笔。每项严格限定为：

```ts
type OrderCancellationCandidate = {
  orderId: string;
  orderNo: string;
  status: 'pending_payment';
  payableAmount: string;
  createdAt: string;
  expiresAt: string;
  cancelable: true;
  items: Array<{
    productName: string;
    color: string;
    size: string;
    quantity: number;
  }>;
};
```

`ChatDisplayService.apply()` 仅在 `list_my_orders` 成功结果通过严格投影校验、且本轮工具查询指向待付款取消候选时创建结构化事件。tool-call 期间 activity 不回显参数或原始 JSON。SSE 使用独立事件 `order-cancellation-candidates`，不从 assistant Markdown 解析订单或按钮参数。

投影校验使用 Zod `strictObject` /严格嵌套对象，拒绝未知字段；验证 UUID、订单号与金额格式、ISO 时间、固定状态、数量边界和最多 5 笔限制。类型由 schema 推导，不手工维护重复运行时校验。异常结果只产生安全工具失败 activity，不产生部分可操作卡片。

在现有 `PublicDisplayEnvelope` v1 中新增可选字段并对缺失值默认 `[]`，保持旧 trace payload 和历史消息可读。`reservedDisplayBytes()` 加入最多 5 笔卡片的预留上限；沿用现有 `MAX_DISPLAY_BYTES` 和 trace payload 限制。最终 assistant 展示与同一 assistant message ID 绑定在现有事务内，避免独立持久化的卡片引用。

候选卡片使用服务端订单查询结果生成。模型生成的订单号、UUID、工具调用 JSON、Markdown 和客户端历史内容都不是卡片数据来源。历史恢复的订单候选同样来自 `publicDisplay` 白名单，点击时仍调用本人 API，并由订单服务执行实时状态校验。

## Trace 与敏感数据

- 当前 `safeAddressToolProjection('list_my_orders', ...)` 已对订单查询结果做字段白名单；扩展订单工具时同步保留必要的安全订单标识和截止时间，仍丢弃未知字段、收货信息和物流字段。
- 工具结果 trace 不直接保存完整卡片源对象。专属 trace 可只存订单号、状态、结果数量和安全错误码；若保留 UUID 或截止时间，必须有测试证明用途必要且不得含收件信息。
- `ChatDisplayService` 从本轮内存中的工具事件生成独立的 `publicDisplay` 卡片投影；只保存卡片明确需要的商品摘要、状态、金额、时间和受限订单 ID。
- 工具 activity 的公开参数/输出保持 null，不把原始工具输入及 JSON 结果复制到公开响应。
- 日志不打印完整工具结果、recipient、shipment、Token 或原始异常对象。
- 原始用户聊天文本及已批准的 trace 历史规则不变；不新增长期记忆写入字段。

## 前端集成

1. `ChatAssistantMessage` 接收类型化 `orderCancellationCandidates` 并渲染最多 5 张订单摘要卡。卡片只包含订单号、状态、商品规格摘要、金额及创建时间，不展示收件、物流资料。
2. 仅 `cancelable === true` 的卡片呈现取消命令；界面提示其为未支付订单取消，不描述为退款。
3. 点击卡片取消命令时，页面按 `orderId` 请求当前本人订单详情；确认仍为待支付后，直接打开现有 `OrderActionDialog`，不先打开完整订单详情弹框，避免用户在卡片与详情间多走一步。
4. 用户在确认弹框明确确认后，复用 `cancelOrder()` 和 `POST /api/orders/:id/cancel`。不从模型回复触发提交。
5. 已确认卡片仍引用旧状态时，详情读取返回当前状态并更新；409 时复用现有刷新逻辑。请求结果未知时显示状态核实入口，不能乐观显示已取消。
6. 增加页面专用的“为候选订单请求取消”动作编排，复用 `useChatOrder` 的当前账号隔离、AbortController、请求版本和提交状态；确认弹框只针对刚刚核实的订单打开，避免详情加载期间账号或会话切换造成串写。
7. 操作成功 Toast 只在取消接口成功后显示；错误复用 `useErrorToast` /现有页面错误状态，不重复展示 Toast 和错误横幅。

类型位于 `apps/web/src/api/types/chat.ts`；SSE 解析及消息 Store 仅增加对应判别联合分支。页面不直接调用 Axios 或依赖后端 DTO。

## Schema 与 HTTP 校验

本功能不增加 HTTP Body、Query 或路由参数，因此不新增 Controller 参数 schema。唯一动作继续沿用订单模块既有输入：

| 输入                                  | 所属 schema 与绑定                                                              | 校验和结果                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /api/orders/:id/cancel` 的 `id` | `orders/dto/order-id.dto.ts` 的 Param Zod schema，绑定现有 `@Param({ schema })` | UUID；非法输入由现有 `StandardSchemaValidationPipe` 返回 400                                          |
| 取消 Body                             | 订单现有严格空对象 schema，绑定 `@Body({ schema })`                             | 只接受 `{}`；未知字段返回 400                                                                         |
| `GET /api/orders/:id` 的 `id`         | 订单既有详情 Param schema                                                       | UUID；非法输入返回 400                                                                                |
| `list_my_orders` 工具输入             | `orders/tool/list-user-orders.tool.ts` 的 Zod strict schema                     | `orderNo` 可选 trim 1–100；`status` 为 OrderStatus；`page` 正整数 1–10、默认 1；拒绝未知键和 `userId` |
| 工具与卡片响应投影                    | `chat-records/display/chat-display.projection.ts` 新增严格候选 schema           | UUID、固定 `pending_payment`、金额/时间格式、合法商品字段、最多 5 项；非法工具结果不生成可操作卡片    |

工具 Zod schema 不经过 Nest Pipe；它由 LangChain 工具执行边界校验。现有 HTTP schema 和 Swagger DTO 保持不变，不添加重复校验管道。响应类型从展示 schema 推导。

## 错误和状态处理

| 情况                     | 后端处理                                                          | 前端处理                                 |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------- |
| 无待付款未过期订单       | 返回空候选数组，模型仅说明没有可取消订单                          | 不渲染候选卡片                           |
| 工具 schema 或结果不合法 | 记录安全失败 activity，不输出候选卡片                             | 保持普通助手错误/无卡片状态              |
| 订单在查询后过期         | 候选仍可能短暂过时；取消 Service 锁内按 DB 时间关闭并返回既有 409 | 读取本人订单当前状态，移除动作并展示状态 |
| 订单查询越权/不存在      | 工具安全错误，不暴露其他账号订单                                  | 不展示无效卡片                           |
| 数据库暂不可用           | 沿用订单 Service 和现有异常映射                                   | 不显示空结果或成功；提供现有重试反馈     |
| 用户取消确认对话框       | 不发 HTTP 请求                                                    | 保持订单未变                             |
| 取消 API 成功            | 返回最新本人订单详情                                              | Toast 成功并以服务端状态更新详情         |
| 取消请求结果未知         | 不在服务端或客户端推断失败/成功                                   | 重读本人订单详情后恢复                   |

## 测试方案

API 所属模块 `spec/` 增加或扩展：

- 可取消查询只返回当前用户、`pending_payment`、`expires_at > clock_timestamp()` 的订单；最多 5 笔且排序稳定。
- 截止时间边界覆盖 `expires_at = clock_timestamp()` 的过期排除；其他状态、他人订单和空结果不进入候选。
- 候选和工具 JSON 严格白名单：不包含 recipient、shipment、userId、内部 Entity 字段；非法金额、UUID、状态、嵌套未知键或超过上限时整批不产生卡片。
- trace writer 对 list orders 结果的存储行为继续脱敏；结构化 `publicDisplay` 恰好只含经 schema 验证的订单卡片。
- 历史 envelope 缺少新字段仍成功恢复为空数组；重复/冲突展示绑定仍按现有规则拒绝。
- 聊天取消按钮直接打开现有确认流程，不先打开完整订单详情弹框；取消确认调用原 API；成功后候选卡同步为服务端返回状态，409、未知结果和账号/会话变化不产生错误状态覆盖或虚假成功。
- 回归现有订单取消事务、超时释放预占、订单详情权限和购买订单详情入口。

当前前端没有安装 Vitest、Vue Test Utils 或 Playwright；本轮不加测试依赖或脚本，使用 API 单元/HTTP 测试和现有 typecheck/build，浏览器 Smoke Test 在实施阶段记录实际执行情况。

## 验证命令

实现阶段依据项目规则执行：

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

不需 Migration。若验证确实需要数据库，使用具名 disposable PostgreSQL 数据库；不得对默认开发库运行清库或测试写入。
