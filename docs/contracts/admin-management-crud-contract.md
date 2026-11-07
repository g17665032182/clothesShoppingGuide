# 管理员运营 CRUD 契约

## 状态与依据

- 状态：已确认。
- 实现状态：管理员商品查看与订单履约页面及查询 API 已实现；浏览器验证缺口见实施文档。
- 所属前端模块：`apps/web/src/pages/admin-products/`、`apps/web/src/pages/admin-orders/`。
- 所属后端协作模块：`product-catalog`、`orders`。
- 关联文档：[管理员运营 PRD](../admin-management/admin-management-prd.md)、[管理员运营设计](../admin-management/admin-management-design.md)。
- 业务边界：本轮商品只读，订单只读加整单发货。

## 权限

- 所有管理员接口要求 Bearer JWT 且当前账号角色为 `admin`、状态为 `active`。
- 非管理员调用管理员接口返回 403。
- 未登录或禁用账号返回 401。
- 页面路由使用 `meta.requiresAuth` 和 `meta.adminOnly`；后端权限不依赖前端路由。

## 商品管理员查询

### `GET /api/admin/product-catalog/products`

Query 提案：

| 字段       | 类型       | 规则                                                          |
| ---------- | ---------- | ------------------------------------------------------------- |
| `page`     | 正整数     | 默认 1                                                        |
| `pageSize` | 正整数     | 默认 20，最大 100                                             |
| `keyword`  | 字符串     | 可选，trim 后最多 160，匹配名称、品牌或外部 ID                |
| `category` | 枚举       | 可选，沿用 `tops`、`bottoms`、`dresses`、`outerwear`、`shoes` |
| `isActive` | 布尔转换值 | 可选，筛选商品启用状态                                        |
| `inStock`  | 布尔转换值 | 可选，按可售数量筛选                                          |

对象使用 `z.strictObject`；未知字段返回 400。分页按 `updatedAt DESC, id DESC` 稳定排序。

响应提案：

```ts
{
  items: Array<{
    id: string;
    externalId: string;
    name: string;
    brand: string | null;
    category: string;
    productUrl: string | null;
    isActive: boolean;
    skuCount: number;
    lowestPrice: string | null;
    totalStock: number;
    totalAvailableStock: number;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}
```

`totalStock` 和 `totalAvailableStock` 仅管理员接口返回；普通用户商品接口继续不返回精确库存。

### `GET /api/admin/product-catalog/products/:id`

Param：UUID `id`，非法参数返回 400，不存在返回 404。

响应增加：

```ts
{
  ...productSummary;
  description: string | null;
  styles: string[];
  occasions: string[];
  fits: string[];
  skus: Array<{
    id: string;
    externalSkuId: string;
    color: string;
    size: string;
    price: string;
    currency: 'CNY';
    stock: number;
    reservedStock: number;
    availableStock: number;
    imageUrl: string | null;
    isActive: boolean;
  }>;
}
```

本轮不提供商品 PATCH、上下架、库存写入或删除。

## 订单管理员查询与履约

复用现有订单契约：

- `GET /api/admin/orders`
- `GET /api/admin/orders/:id`
- `POST /api/admin/orders/:id/ship`

订单列表 Query 为现有 `adminOrderQuerySchema`：`page`、`pageSize`、`status`、`orderNo`、`userId`。未知字段返回 400。

订单详情只读返回订单和明细快照、收货人、物流、金额及状态时间。

### 发货

Body：

```ts
{
  carrier: string; // trim 后 1-100 字符，不允许控制字符
  trackingNo: string; // trim 后 1-100 字符，不允许控制字符
}
```

成功返回管理员订单详情 200。只有 `pending_shipment` 首次允许发货；已发货/已完成且物流相同的重复请求安全返回当前订单；不同物流覆盖返回 409。库存扣减、预占释放和状态变更由后端事务完成。

## 错误与前端行为

| 状态码  | 页面行为                                   |
| ------- | ------------------------------------------ |
| 400     | 显示输入或筛选错误，不自动重试             |
| 401     | 使用现有认证刷新；刷新失败回登录页         |
| 403     | 显示无权限，并返回管理员入口或账户页       |
| 404     | 详情显示资源不存在，列表保留当前数据       |
| 409     | 发货冲突显示后端安全错误，允许重新读取订单 |
| 503/500 | 保留当前列表，显示可重试错误               |

## 非目标

- 商品编辑、上下架、库存写入和删除。
- 订单取消、代付、退款、改价、状态强制修改和批量发货。
- 导出、报表、实时物流、支付回调和售后。

## 已确认补充

1. 关键字匹配名称、品牌与外部 ID；`%`、`_` 按字面值匹配，不作为通配符。
2. 管理员可见精确实物、预占和可售库存；商品聚合统计包含停用 SKU，商品状态和库存筛选相互独立。不将库存充足等同于商品/SKU 已启用。
3. 商品及订单详情使用 Dialog，现有用户管理 URL 保持兼容。
4. 发货使用独立 Dialog；成功后刷新列表及详情，失败保留输入。
