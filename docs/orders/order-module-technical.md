# 订单模块技术文档

## 文档信息

- 状态：已确认。
- 实现状态：技术方案已实现；验证记录见[实施文档](./order-module-implementation.md)。
- 关联文档：[订单 PRD](./order-module-prd.md)、[订单设计](./order-module-design.md)、[订单 CRUD 契约](../contracts/order-crud-contract.md)、[商品目录技术文档](../product-guide/product-catalog-technical.md)。
- 所属应用：`apps/api`。
- 本地依赖：NestJS 12.2.0、MikroORM 7.2.5、PostgreSQL、Zod 4.6.7；不新增运行时依赖。
- 最后更新：2026-11-07。

## 实现目标

实现契约中的规格查询、订单创建与本人/管理员查询、模拟支付、取消、发货、确认收货和超时关闭；同时使商品搜索、导入、Seeder 与订单共同遵守可售库存不变量。

所有状态转换、价格和收货快照、幂等检查以及库存竞争由服务端处理。模拟支付仅推进本地订单状态，不连接或模拟第三方支付接口。

## 本地能力与依赖依据

- `apps/api/package.json` 已有 NestJS、MikroORM PostgreSQL 驱动、MikroORM Migration、Zod；现有请求校验使用全局 `StandardSchemaValidationPipe`。
- MikroORM 7.2.5 的本地服务代码已使用 `EntityManager.transactional()`、`LockMode.PESSIMISTIC_WRITE`、PostgreSQL advisory lock 与事务上下文；用户记忆任务也已使用 `FOR UPDATE SKIP LOCKED` 批量认领。
- `UserMemorySchedulerService` 和清理服务已示范 `OnModuleInit` / `OnModuleDestroy`、`setInterval`、`unref()`、`RequestContext` 及优雅停止。当前未安装 `@nestjs/schedule`，订单到期任务沿用已有模式，不引入调度库。
- 商品目录已有事务式全量导入、测试 Seeder、PostgreSQL `numeric(12,2)` SKU 单价及稳定 SKU UUID。
- 金额从数据库以十进制字符串读取；计算和比较使用整数分（`bigint`），写回固定两位小数，不以 JavaScript 浮点数累计。

实现前仍需按项目文档约定核对 MikroORM 7.2.5 事务/锁 API 的官方说明，并对实际 PostgreSQL SQL 与事务竞争编写集成测试。无需引入通用订单库或自行替代 ORM、验证器、调度器。

## 模块与目录结构

```text
apps/api/src/
  orders/
    orders.module.ts
    index.ts
    controller/
      orders.controller.ts
      admin-orders.controller.ts
    service/
      orders.service.ts
      order-expiration.service.ts
    entity/
      order.entity.ts
      order-item.entity.ts
      order-idempotency.entity.ts
    dto/
      create-order.dto.ts
      order-query.dto.ts
      order-id.dto.ts
      ship-order.dto.ts
      order-response.dto.ts
    spec/
      order-request-schema.spec.ts
      orders.service.spec.ts
      orders.http.spec.ts
      orders.postgres.spec.ts
  product-catalog/
    controller/
      product-sku.controller.ts
    dto/
      product-sku-query.dto.ts
      product-sku-response.dto.ts
    service/
      product-catalog-order.port.ts
      product-catalog-order.service.ts
      product-catalog-import.service.ts
      product-catalog.service.ts
    spec/
      product-catalog-order.postgres.spec.ts
  order-catalog-coordination/
    order-catalog-coordination.module.ts
    order-catalog-import.service.ts
```

目录按职责落地；不存在多个紧密协作文件时，不机械创建子目录。订单 Entity 和订单业务规则仅由 `orders` 所有。商品/SKU Entity、SKU 行锁和可售库存查询仅由 `product-catalog` 所有。`order-catalog-coordination` 是显式应用编排边界，只处理“商品导入与订单关闭需同一事务”的跨模块用例，不成为通用共享模块。

`OrdersModule` 依赖并导入 `ProductCatalogModule` 的公开订单库存端口；商品模块不导入订单模块。`OrderCatalogCoordinationModule` 同时依赖两个模块的公开应用入口，承接目录导入事务，不构成模块间反向引用。根 `AppModule` 负责接入协调模块；目录 CLI 与测试 Seeder 通过同一协调服务执行写入，不能直接 upsert 实体绕过库存规则。

## 持久化模型与 Migration

新增以下订单表；表名和字段名以最终 Entity 映射及生成 SQL 审查结果为准：

### `orders`

- UUID 主键、唯一 `order_no`、用户 UUID、状态和关闭原因。
- CNY 金额字段使用 PostgreSQL `numeric`，至少两位小数；单价受既有 SKU `numeric(12,2)` 上限约束。按单价、行数和数量上限，`items_amount` 与 `payable_amount` 至少使用 `numeric(16,2)`；Migration 中明确精度并由测试验证上界。
- `user_id` 关联现有用户 UUID，禁用不删除订单；外键禁止用户物理删除时级联清除订单。
- 收件人姓名、手机号、地址作为不可变快照列保存；不关联地址簿。
- 模拟支付标识、支付截止时间、支付/发货/完成/关闭时间、物流快照及创建更新时间。
- 创建时间、动作时间与 `expires_at` 使用 PostgreSQL `now()` 生成，截止时间由同一数据库时钟加 30 分钟，避免多 API 实例的系统时钟差异影响支付边界。
- 索引：订单号唯一；用户与创建时间/ID 复合索引；状态与创建时间/ID 查询索引；待支付超时扫描索引（仅覆盖 `pending_payment` 状态的部分索引）。

### `order_items`

- UUID 主键、订单 UUID、SKU UUID、商品外部标识/名称/图片、颜色/尺码、单价、数量及行金额快照。
- 每单 SKU 唯一；按 `sku_id` 建立库存预占汇总所需索引。
- SKU 关联使用禁止商品/SKU 物理删除的外键策略，历史快照字段独立保存，不能因目录改名、改价、下架而覆盖。不得设置会删除订单历史的级联规则。

### `order_idempotency`

- UUID 主键、用户 UUID、客户端幂等键、规范化输入摘要、订单 UUID 和创建时间。
- `(user_id, idempotency_key)` 唯一；订单 UUID 唯一。只存规范化请求的 SHA-256 摘要，不持久化收货请求原文作为重复副本。

Migration 必须是增量 Migration，不修改或重建既有商品、用户、聊天和偏好数据。审查外键、精度、约束、部分索引和回滚风险。下单幂等记录与订单、明细在同一事务创建。订单、明细与幂等记录无删除接口。

## 库存模型与并发协议

### 预占口径

不在 SKU 上保存另一份可漂移的 `reserved_stock` 计数，也不新增独立预占表。有效预占量由 `order_items` 连接 `orders` 后汇总：订单状态为 `pending_payment` 或 `pending_shipment` 的明细占用数量。这样订单状态转换本身就是预占/释放的唯一事实来源：

```text
available = product_skus.stock - sum(active order item quantities)
0 <= sum(active order item quantities) <= product_skus.stock
```

### 所有写操作的锁序

通过 `ProductCatalogOrderPort` 提供仅模块公开的事务内能力：按 UUID 升序锁定 SKU 行、读取规格与实物库存、按给定 SKU 集合计算预占量。端口返回白名单数据，不返回 `Product` / `ProductSku` Entity 或 Repository。调用方使用与操作相同的事务 EntityManager；该 EntityManager 是项目现有基础设施类型，不代表允许跨模块读写对方 Entity。

下单、取消、支付、到期关闭、发货、导入/Seeder 中的下架处理统一遵循以下顺序：

1. 对候选订单或商品/SKU 做不加锁读取，仅取得需要锁的稳定 ID；不得基于该读取结果直接决定状态转换。
2. 在同一 PostgreSQL 事务中，以 SKU UUID 升序取得涉及 SKU 行的 `FOR UPDATE` 锁。下单针对请求 SKU；订单动作针对该订单的所有 SKU；目录导入针对所有受影响 SKU。
3. 如动作涉及已有订单，再按订单 UUID 升序取得订单行写锁，并重新读取和校验状态、归属、截止时间与当前商品状态。
4. 在锁仍持有时重新计算预占量/可售量，完成完整订单或整单失败；最后 flush 并提交。

固定“SKU 行 -> 订单行”锁序，防止目录导入与订单动作形成相反的锁依赖。请求内多个 SKU 排序后再加锁，减少多 SKU 事务之间的死锁。数据库死锁错误沿用现有数据库异常映射；必要时只对明确可重试的事务冲突做有界重试，不将任意失败伪装为库存不足。

并发下单只有在持有相同 SKU 行锁后重新读取预占汇总，才可判断可售量；规格查询和商品搜索的读结果仅是快照，不能代替下单原子检查。SKU 规格查询、商品搜索的 `inStock` 与订单创建均使用 `stock - active reservations > 0`。

### 状态动作与锁的应用

- **创建**：事务内先按用户与键查幂等记录；命中时若已到期，先在本事务完成超时关闭再返回当前订单。并发首写由唯一约束裁决。锁全部 SKU，核对商品与 SKU 启用状态，读取当前价格和快照，整单校验可售量，然后写订单、明细和幂等记录；`created_at` 与 `expires_at` 用数据库时钟表达。失败回滚所有写入。
- **幂等冲突恢复**：若唯一约束冲突，回滚失败事务，再以新事务读取同用户同键记录。摘要一致则返回原订单当前投影，不一致返回 409。并发请求不通过“先查后插”单独保证唯一性。
- **支付/取消**：先取得订单明细 SKU ID，再按固定顺序锁 SKU、订单并重验买家和状态。支付只改变订单状态，预占汇总仍包含该订单；取消改成 `closed` 并记录原因，提交后预占自然释放。
- **发货**：同样锁 SKU 后锁订单；确认状态为 `pending_shipment` 后，对每个 SKU 执行受条件保护的实物库存扣减，随后同事务写 `pending_receipt` 与物流快照。订单状态离开有效预占集合后占用归零；实物库存同步减少，库存不重复扣减。
- **收货**：锁订单关联 SKU 后锁订单并校验买家/状态；仅更新完成状态和首次完成时间，不改实物库存。
- **超时关闭**：执行到期检查的动作（如支付）若发现数据库时钟已到 `expires_at`，在事务中关闭并释放，再提交一个“已关闭”结果；事务提交后由 Controller/Service 抛出 409，不能在事务回调中抛错回滚关闭。

### 商品下架、库存导入与 Seeder

应用编排服务把完整导入先做 Zod 全量解析和重复 ID 检查，再在单个事务内：

1. 读取本批涉及的 SKU 和可能受影响的未支付订单 ID，再读取这些候选订单的全部 SKU ID；这些预读只用于构造锁集合，不用于判定最终状态。
2. 合并导入影响的 SKU 与候选订单的全部 SKU，去重后按 UUID 升序一次性锁定。导入期间的新下单会与受影响 SKU 行竞争；锁取得后必须重新查询下架影响订单及其明细。
3. 若锁后复核发现有订单/SKU 不在已锁集合，立即回滚并从新的事务重新构造锁集合；不得在持有订单锁时补加 SKU 锁。支付或取消若先完成，复核时已不再是待支付订单。
4. 对仍待支付的受影响订单按订单 UUID 升序加锁并复核，将整单关闭为 `product_unavailable`。整张订单所有 SKU 的预占都由状态变更释放。
5. 计算下架释放后的有效预占量；验证每个输入实物库存不低于该值。
6. 在仍持有锁的同一事务内 upsert 商品/SKU 后提交。任一步失败则商品变化、订单关闭和库存预占变更一并回滚。

目录导入与订单转换的锁序必须先一次性取得完整 SKU 锁集合，再取得订单锁；不得持有订单锁后再追加 SKU 锁。若候选集合复核发生变化，必须回滚并在新事务重试，或以明确的可重试冲突失败，不能突破锁序。

CLI 的 dry-run 只解析和报告，不访问写事务。正式 CLI 与 `ProductCatalogTestSeeder` 通过 `OrderCatalogCoordinationModule` 的同一导入应用入口写入；Seeder 不得直接调用 `em.upsert(ProductSku, ...)` 覆盖库存。诊断仅包含外部商品/SKU 标识和冲突类别，不输出买家、地址或订单个人信息。

## 事务与跨模块接口

`ProductCatalogOrderPort` 是商品模块公开给订单模块的窄端口，建议包含：

- `lockSkus(transaction, skuIds)`：去重排序并写锁定 SKU，返回可下单需要的公开快照/可用性字段。
- `getReservedQuantities(transaction, skuIds)`：以订单状态和明细聚合有效预占数量。
- `decrementStockForShipment(transaction, skuQuantities)`：在持锁事务内以 SKU ID 与足量条件更新库存；更新数不足视为一致性冲突并回滚。
- `listSkuIdsForCatalogChanges(transaction, changes)`：供导入协调器计算、锁定本次导入可能改变状态或实物库存的 SKU 集合。

端口的 transaction 参数使用 `EntityManager`，只用于确保端口 SQL/Repository 操作加入调用方已经打开的事务，不允许端口自行提交或创建另一个根事务。事务上下文必须取自该 EntityManager。订单模块不导入商品私有 Entity；商品模块不导入订单 Entity。

`OrderCatalogImportService` 是唯一同时调用目录写入入口和订单关闭入口的编排点，拥有目录写事务并保证两侧操作使用同一事务 EntityManager。CLI 通过 Nest 应用上下文获取该编排服务，而不是复制导入逻辑。订单操作的事务由订单 Service 开启；目录端口只加入事务，不接管订单状态写入。

## 超时关闭后台任务

采用应用现有生命周期轮询模式，不增加 `@nestjs/schedule`：

- `OrderExpirationService` 启动时立即执行一次，随后以配置常量间隔轮询；定时器 `unref()`，销毁时清理定时器并等待在途轮询完成。
- 每轮只选择有限数量、`pending_payment` 且 `expires_at <= now()` 的候选订单 ID，按截止时间和 ID 稳定排序。候选查询不持锁。
- 每个候选在独立短事务中读取 SKU ID，先按序锁 SKU，再锁订单并使用 PostgreSQL `now()` 重新判断状态/截止时间；仍到期时设置 `closed/payment_expired`。多个实例可以重复扫描，由行锁和二次条件检查保证单次转换与释放。
- 单个订单处理失败不阻断整批；记录有限错误码并限频告警，不记录收货信息。进程停止后由后续轮询继续处理积压。
- 所有支付入口依据 `expires_at` 和数据库时钟判定，不依赖后台任务准点运行。

轮询间隔、单批数量与最大并发数在实现阶段按数据库连接池和 API SLA 设定为有界常量；不能将批次扩展成全表加载。

## API、Schema 与错误映射

Schema 放在 `apps/api/src/orders/dto/` 与 `apps/api/src/product-catalog/dto/`，导出输入类型和解析后类型。Controller 只接收已校验参数、读取 `@CurrentUser()`、调用应用服务并返回响应投影。继续复用 JWT Guard、`@Roles()`、`StandardSchemaValidationPipe`、全局数据库异常过滤器；Swagger DTO 只作 API 文档元数据。

Query 参数以 URL 字符串作为 `z.input`，通过 `z.coerce.number().int()` 转换到 `z.output`；空字符串转换后因正整数边界校验失败，非整数、越界值和未知字段同样拒绝。Body/Param 不进行数字字符串隐式转换。对象均使用 `z.strictObject`，必填项不接受 `null`。

| 请求            | Schema 所属位置与字段规则                                                                                                                                                                                                                                                                                     | Controller 绑定                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 创建 Body       | `orders/dto/create-order.dto.ts`：`z.strictObject({ idempotencyKey: uuid, items: array(strictObject({ skuId: uuid, quantity: int 1..99 })).min(1).max(50), recipient: strictObject({ name, phone, address }) })`；收件信息 trim 后按契约限制；refine 拒绝重复 SKU。金额、用户、状态、快照和库存字段均不接受。 | `@Body({ schema: createOrderSchema })`                           |
| 本人列表 Query  | `orders/dto/order-query.dto.ts`：严格对象；`page`、`pageSize` 字符串转正整数并默认 1/20、上限 100；`status` 为状态枚举；`orderNo` trim 后 1..100。`userId` 未知字段拒绝。                                                                                                                                     | `@Query({ schema: customerOrderQuerySchema })`                   |
| 管理列表 Query  | 同文件的管理员 schema：上述分页/状态/订单号规则，另有可选 UUID `userId`；不得将此 schema 绑定到本人列表。                                                                                                                                                                                                     | `@Query({ schema: adminOrderQuerySchema })`                      |
| SKU 列表 Query  | `product-catalog/dto/product-sku-query.dto.ts`：严格对象；`productExternalId` trim 后 1..160；分页转型/默认/上限同上。                                                                                                                                                                                        | `@Query({ schema: productSkuQuerySchema })`                      |
| 订单 ID Param   | `orders/dto/order-id.dto.ts`：严格对象中的 UUID `id`。                                                                                                                                                                                                                                                        | `@Param({ schema: orderIdSchema })`                              |
| 发货 Body       | `orders/dto/ship-order.dto.ts`：严格对象 `{ carrier, trackingNo }`，trim 后各 1..100，拒绝控制字符。                                                                                                                                                                                                          | `@Body({ schema: shipOrderSchema })`                             |
| 无字段动作 Body | 同文件导出 `z.strictObject({})`；拒绝客户端附带金额、支付状态等字段。                                                                                                                                                                                                                                         | 支付、取消和确认收货 `@Body({ schema: emptyOrderActionSchema })` |

所有 Schema 的输出类型由 `z.output<typeof schema>` 派生；若 Query Schema 采用 coercion，明确用 `z.input` 表示原始 HTTP 输入。订单响应类型来自专用白名单投影，不从 Entity 派生或直接序列化 Entity。

校验失败由现有 Pipe 映射为 400。业务层错误保持语义：未认证/禁用账号 401、非管理员管理操作 403、本人访问其他用户订单与资源不存在 404、库存不足/幂等内容冲突/不允许的状态动作 409；不把状态冲突转换为 schema 400。数据库错误沿用全局映射，不返回 SQL/连接信息。Schema 单测验证边界、转换、默认值、未知字段和 400 映射；HTTP 测试验证 Controller 参数绑定确实经过全局 Pipe。

## 查询与响应投影

- SKU 查询仅返回有效父商品下的有效 SKU，按 SKU UUID 稳定排序；返回 SKU 标识、商品外部 ID/名称、颜色、尺码、单价、CNY、图片和 `inStock`，不返回实物库存或预占数量。有效商品没有 SKU 时返回空页；不存在/停用父商品按契约返回 404。
- 本人和管理列表使用固定稳定排序 `created_at DESC, id DESC`，执行数据库分页并返回 `{ items, total, page, pageSize }`。列表摘要不包含完整收件地址或手机号。
- 详情 Mapper 按调用方角色投影明细和收件快照；管理响应额外允许 `userId`，不得包含幂等摘要、ORM 元数据或用户敏感字段。
- 全部金额从 PostgreSQL `numeric` 以字符串映射；响应统一两位小数字符串。精确单价解析为分，使用 `bigint` 乘数量、累加，再格式化为十进制字符串。

## 安全与日志

- 复用认证 Guard、当前用户和角色守卫；买家 ID 永远来自认证上下文。本人资源查询在数据库条件中同时约束订单 ID 与用户 ID。
- 不提供真实支付 URL、支付回调、伪造平台流水号、退款或售后能力；所有订单响应明确带 `paymentMode: "simulated"`。
- 物流、收件信息和完整订单明细仅在授权详情中返回，不写日志、错误追踪标签或后台任务诊断。
- 下单幂等摘要只对规范化后的字段白名单计算；比较用固定 JSON 键序、收件字段 trim、SKU ID 排序后再用 SHA-256。摘要不能作为 API 响应字段。
- 查询必须有分页上限；到期任务使用有界批次；目录输入继续执行现有文件字节/记录数限制。
- 禁止通过错误内容泄露其他买家订单是否存在；本人订单详情对他人订单统一 404。

## 测试方案

### Schema 与 HTTP

- 所有 Body、Query、Param 合法/非法边界、未知字段、显式 null、默认值和数字字符串转换。
- 重复 SKU、数量上下界、手机号/地址/物流边界、UUID/订单状态非法输入。
- HTTP 400 Pipe 映射、未认证 401、管理越权 403、本人越权 404，以及响应白名单和列表隐私字段。

### 订单 Service 单元测试

- 整单成功、SKU 下架、商品停用、库存不足及事务内任一明细失败回滚。
- 同键同内容、同键异内容、不同用户同键、并发唯一约束冲突后的重读恢复。
- 锁价/金额精度、模拟支付标识、重复支付/取消/发货/确认收货及禁止状态转换。
- 30 分钟边界、超时动作“先提交关闭后返回 409”、禁用账号行为。
- 列表与详情 Mapper 不泄漏内部/敏感字段。

### PostgreSQL 并发与 Migration 测试

- 并发竞争最后一件库存，不超卖；同一多 SKU 订单失败不留部分订单或占用。
- 取消、支付、超时、下架竞争时只有一个合法转换，预占汇总不重复释放。
- 发货/导入并发、下架多 SKU 订单整单释放、导入库存低于剩余预占时全批回滚。
- 多 API worker 同时过期扫描，订单仅关闭一次；重启后积压订单可关闭。
- Migration 前后保留用户、商品/SKU ID、库存及聊天数据；SQL 检查 FK、唯一索引、查询索引、金额精度和约束。
- 所有 PostgreSQL 测试使用隔离测试数据库，不运行 `migration:fresh` 指向开发或共享数据库。

## 验证命令

实现阶段按仓库要求执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
```

另需在隔离 PostgreSQL 执行新增 Migration 和并发集成测试，并完成规格查询到确认收货的 HTTP Smoke Test。支付路径只验证模拟状态，不连接真实支付服务。文档阶段只做格式与差异检查，不运行代码级验证。

## 已确认的技术决策

1. 采用 SKU 行锁与订单状态聚合计算预占；库存写操作遵循 SKU UUID 升序、再订单 UUID 升序的锁序。
2. 通过公开库存端口与订单目录协调模块保持商品/订单模块边界，并让目录导入和下架关闭处于同一事务。
3. 到期关闭沿用现有 Nest 生命周期轮询模式，不新增调度依赖。
4. 金额使用 PostgreSQL 精确 `numeric` 和应用层整数分（`bigint`）运算。
5. 超时动作先提交关闭并释放预占，再由事务外返回 409。

订单实现与 PostgreSQL 验证结果记录于[实施文档](./order-module-implementation.md)。
