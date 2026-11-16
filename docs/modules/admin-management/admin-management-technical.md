# 管理员运营页面技术文档

## 文档信息

- 状态：已确认。
- 实现状态：页面、管理员只读商品接口和导航已实现；验证记录见实施文档。
- 关联文档：[管理员运营 PRD](./admin-management-prd.md)、[管理员运营设计](./admin-management-design.md)、[管理员运营 CRUD 契约](../../contracts/admin-management-crud-contract.md)。
- 前端应用：`apps/web`，Vue 3 + Vite + TypeScript + Vue Router + shadcn-vue。
- 后端协作：`apps/api` 的 `product-catalog` 只读管理员查询，以及现有 `orders` 管理查询/发货接口。
- 最后更新：2026-11-07。

## 实现目标

新增管理员商品查看页和订单履约页，复用现有管理员用户页面、认证刷新、Axios 请求底座、订单 API 和 shadcn-vue 组件。商品接口新增管理员安全投影和精确库存字段；订单发货继续由后端事务完成，前端不复制库存或状态逻辑。

不新增数据库表、商品写入 API、订单状态机、真实支付或第三方物流依赖。

## 本地能力与依赖

- API 请求统一使用 `apps/web/src/api/index.ts` 的 `apiRequest`，模块请求放入 `src/api/modules/`，类型放入 `src/api/types/`。
- 认证状态复用 `src/lib/auth.ts`，路由复用 `meta.requiresAuth`、`meta.adminOnly` 和全局 Guard。
- 页面结构遵循 `src/pages/<page>/index.vue`、`page.ts`、`components/`。
- shadcn-vue 已有 `Table`、`Card`、`Badge`、`Button`、`Input`、`Select`、`Dialog`、`Alert`、`Empty`、`Skeleton`、`Spinner`、`Tooltip` 等组件；不手写同类基础组件。分页组件当前未发现，实施时通过 shadcn-vue CLI 添加或复用项目已有分页实现。
- 需要的图标使用已安装的 `@lucide/vue`，按钮图标通过 `data-icon="inline-start|inline-end"`。
- 异步页面参考记忆页面的 `AbortController`、请求版本号和 `onBeforeUnmount` 清理模式。

## 目录与文件所有权

```text
apps/web/src/
  api/
    modules/
      admin-products.ts
      admin-orders.ts
    types/
      admin-products.ts
      admin-orders.ts
  pages/
    admin-products/
      index.vue
      page.ts
      components/
        ProductFilters.vue
        ProductTable.vue
        ProductDetailDialog.vue
    admin-orders/
      index.vue
      page.ts
      components/
        OrderFilters.vue
        OrderTable.vue
        OrderDetailDialog.vue
        ShipOrderDialog.vue
  router/
    index.ts
```

公共管理员导航如需抽取，放入现有共享布局/导航公开入口；不从商品页引用订单页私有组件或状态。

## 后端技术方案

### 管理员商品查询

在 `apps/api/src/product-catalog/` 内新增管理员查询职责目录或服务，不直接返回 Entity：

- `GET /api/admin/product-catalog/products`
- `GET /api/admin/product-catalog/products/:id`

复用 `Product`、`ProductSku` Repository 和现有预占视图 `active_order_sku_reservations`。管理员列表计算：

```text
totalStock = sum(product_skus.stock)
totalAvailableStock = sum(stock - reserved_quantity)
```

精确库存只出现在管理员响应；普通商品搜索、SKU 规格查询和聊天投影保持现有脱敏字段。

Controller 只绑定 Zod Query/Param schema、读取管理员权限并调用 Service。Service 使用数据库分页和稳定排序，不在内存加载全量商品。详情按商品 ID 返回 SKU 精确库存、预占和可售数量。

### 订单接口复用

不新增订单管理 API，前端复用：

- `GET /api/admin/orders`
- `GET /api/admin/orders/:id`
- `POST /api/admin/orders/:id/ship`

发货 Body 复用现有 `shipOrderSchema`。后端继续校验 `pending_shipment` 状态、物流覆盖冲突、库存扣减和预占释放。

## 前端 API 类型与适配器

### `admin-products.ts`

- `listAdminProducts(token, query, signal?)`
- `getAdminProduct(token, productId, signal?)`

Query 类型包括 `page`、`pageSize`、`keyword`、`category`、`isActive`、`inStock`。适配器只拼接 query 参数，不让页面直接调用 Axios。

### `admin-orders.ts`

- `listAdminOrders(token, query, signal?)`
- `getAdminOrder(token, orderId, signal?)`
- `shipAdminOrder(token, orderId, payload, signal?)`

类型从 API 响应投影独立维护，不复用后端 Entity 或前端普通用户订单类型中的隐含字段。

## 请求 Schema 与错误映射

### 后端商品 Query Schema

建议位置：`apps/api/src/product-catalog/dto/admin-product-query.dto.ts`。

```ts
z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: safeText(160).optional(),
  category: categorySchema.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  inStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
```

Query 原始类型使用 `z.input`，解析后类型使用 `z.output`。未知字段、空字符串、越界分页和非法枚举由 `StandardSchemaValidationPipe` 映射为 400。

### 后端商品 Param Schema

建议位置：`apps/api/src/product-catalog/dto/admin-product-id.dto.ts`。

```ts
z.strictObject({ id: z.uuid() });
```

非法 UUID 返回 400，不存在商品返回 404。

### 发货 Schema

继续使用现有 `orders/dto/ship-order.dto.ts` 的 `shipOrderSchema`，不在前端重复实现后端业务校验。前端只做即时必填提示，服务端响应仍是最终结果。

### 页面错误处理

- 401：由现有 Axios Refresh 流程处理；刷新失败回登录页。
- 403：显示无权限提示，不重试。
- 404：详情关闭或显示资源不存在。
- 409：发货冲突后保留表单，提供重新读取订单操作。
- 500/503/网络错误：保留列表/详情已有数据，显示 Alert 和重试按钮。

## 页面状态与交互

### 商品页

`page.ts` 管理：

- `listStatus`: `idle | loading | success | empty | error`
- `detailStatus`: `idle | loading | success | error`
- `filters`、`page`、`pageSize`
- `products`、`total`
- `selectedProductId`、`selectedProduct`
- `error`

筛选变化重置页码并取消上一请求；详情请求只允许当前选择更新状态。商品详情使用 `Dialog`，包含 `DialogTitle` 和 `DialogDescription`，SKU 表格支持横向滚动。

### 订单页

`page.ts` 管理：

- `listStatus`、`detailStatus`
- `filters`、`page`、`pageSize`
- `orders`、`total`
- `selectedOrderId`、`selectedOrder`
- `shipDialogOpen`
- `shipStatus`: `idle | submitting | success | error`
- `shipError`

只有详情状态为 `pending_shipment` 才显示发货按钮。发货成功后关闭表单、刷新详情和当前列表；刷新保持原筛选和页码。发货提交期间禁用取消/提交控件并显示 Spinner，防止重复请求。

### 生命周期保护

- 列表、详情和发货请求各自使用 `AbortController`。
- 页面卸载时取消未完成请求。
- 通过递增 request version 或比较 controller 确保旧响应不能覆盖新筛选。
- 详情切换时清除旧错误和过期详情。

## 组件设计

- `ProductFilters` / `OrderFilters`：显式 Props 和 Emits，只负责筛选控件。
- `ProductTable` / `OrderTable`：显式 Props 和 Emits，只负责表格展示与选择/操作事件。
- `ProductDetailDialog` / `OrderDetailDialog`：只读详情，不能修改 Props。
- `ShipOrderDialog`：使用 `modelValue`、`update:modelValue`，接收订单和提交状态，通过 Emits 提交 `{ carrier, trackingNo }`。
- 页面主文件只组合页面结构、组件和基础事件，不直接请求 API。

## 安全与可观测性

- 商品精确库存只进入管理员 API 和管理员页面，不进入普通查询、聊天卡片或 LLM。
- 收货地址和手机号只在管理员订单详情展示，不写入前端日志或错误文本。
- 前端错误展示使用 `ApiError` 的安全消息，不渲染原始响应对象。
- 商品详情链接仍按现有协议安全约束处理；不在前端抓取外链。
- 不记录物流单号、收货信息和访问令牌。

## 测试方案

### 前端

- API 适配器验证 query 序列化、请求方法、token、AbortSignal 和响应类型守卫。
- `admin-products` 页面覆盖加载、空结果、错误、筛选重置分页、详情加载和过期响应保护。
- `admin-orders` 页面覆盖列表筛选、详情、仅待发货显示按钮、发货提交中、成功刷新、409 保留表单和失败重试。
- 路由覆盖未登录、普通用户和管理员三种访问结果。

### 后端

- 商品管理员 Query/Param schema：合法输入、未知字段、布尔转换、分页边界和 400。
- 管理员权限、精确库存投影、资源不存在 404、列表分页和稳定排序。
- 订单管理现有发货契约继续覆盖状态冲突、重复物流和库存事务。

项目当前未安装 Vitest/Vue Test Utils；按现有测试基础设施先使用可执行的 TypeScript/HTTP 测试方式，不临时引入新测试框架。

## 验证命令

实现阶段至少执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm check
```

另需执行管理员 API 权限 Smoke Test，以及管理员登录后商品查看、订单查看、待发货订单发货的浏览器 Smoke Test。支付仍为模拟支付，不连接真实支付服务。

## 已确认技术决策

1. 新增两个管理员商品只读 API，返回精确实物库存、预占库存和可售库存。
2. 商品和订单详情统一使用 `Dialog`，不新增 `Sheet` 组件；列表分页使用现有或通过 shadcn-vue CLI 添加的分页组件。
3. 商品页支持关键字、分类、启用状态和可售状态筛选；订单页沿用现有订单管理员 Query。
4. 发货成功后自动刷新详情和当前列表，保留筛选和分页。

本方案已按用户确认后的实施文档落地。测试与未完成验证见[实施文档](./admin-management-implementation.md)。
