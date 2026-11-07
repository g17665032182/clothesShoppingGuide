# 管理员运营页面实施文档

## 文档信息

- 状态：已确认。
- 实现状态：代码已实现，格式、类型、构建、API/数据库验证通过；已登录浏览器全流程尚未完成。
- 关联文档：[管理员运营 PRD](./admin-management-prd.md)、[管理员运营设计](./admin-management-design.md)、[管理员运营技术文档](./admin-management-technical.md)、[管理员运营 CRUD 契约](../contracts/admin-management-crud-contract.md)。
- 最后更新：2026-11-07。

本实施文档获用户确认后已开展实施。以下保留实施步骤与所有权约束；实际结果见文末交付记录。

## 实施目标与非目标

实现管理员商品查看页、订单查看页和整单发货流程，并接入现有管理员用户页面导航。

不实现商品编辑/上下架/库存写入、订单取消/改价/代付/退款、批量发货、导出报表、物流轨迹和真实支付。

## 开发前检查

主代理在启动子代理前：

1. 检查 `git status`，保留现有订单模块和其他未提交改动。
2. 重读本业务 PRD、设计、CRUD 契约和技术文档；若需要加入商品写入或扩大订单动作范围，回到设计阶段重新确认。
3. 核对 `apps/web` 当前路由、`auth`、Axios 底座、API 类型约定、shadcn-vue 已安装组件和页面布局。
4. 固定后端管理员商品 API 的 Query/Param schema、响应类型、分页排序和精确库存投影，前后端不得各自发明字段。
5. 明确子代理独占文件范围；根路由、管理员导航、公共 API 入口和最终验证由主代理维护。
6. 确认不新增运行时依赖；如需 Pagination 组件，优先通过 shadcn-vue CLI 添加并审阅生成文件。

## 子代理分工与文件所有权

所有子代理必须阅读 `AGENTS.md`、本业务四份文档和现有管理员用户页面。新增必要注释使用中文，页面组件必须显式声明 Props/Emits，不能跨页面引用私有组件。

### 子代理 A：管理员商品后端查询 API

**所有权：**

- `apps/api/src/product-catalog/controller/admin-product-catalog.controller.ts`
- `apps/api/src/product-catalog/dto/admin-product-query.dto.ts`
- `apps/api/src/product-catalog/dto/admin-product-id.dto.ts`
- `apps/api/src/product-catalog/dto/admin-product-response.dto.ts`
- `apps/api/src/product-catalog/service/admin-product-catalog.service.ts`
- `apps/api/src/product-catalog/spec/admin-product-catalog.*.spec.ts`
- `apps/api/src/product-catalog/product-catalog.module.ts` 中与上述 provider/controller 注册直接相关的局部修改

**任务：**

- 实现管理员商品分页列表和商品详情。
- 复用现有 Product/ProductSku Entity、预占视图和 `RolesGuard`，只返回管理员安全投影。
- 返回精确实物库存、预占库存和可售库存；不改变普通商品查询和聊天投影。
- 使用 Zod strict Query/Param schema、`@Roles(UserRole.ADMIN)` 和现有数据库访问模式。
- 分页按稳定 `updatedAt DESC, id DESC` 排序，避免内存加载全量数据。

**禁止修改：**

- 前端文件、订单业务代码、Migration、商品导入 CLI/Seeder 和根 `AppModule`。

### 子代理 B：管理员商品页面

**所有权：**

- `apps/web/src/api/modules/admin-products.ts`
- `apps/web/src/api/types/admin-products.ts`
- `apps/web/src/pages/admin-products/**`

**任务：**

- 实现商品筛选、分页、列表、详情 Dialog 和加载/失败/空数据状态。
- 使用 `apiRequest`、AbortController、页面级 `page.ts` 和私有组件。
- 精确库存只在管理员页面显示；不复用普通聊天商品卡片作为管理表格。
- 表格和详情使用现有 shadcn-vue 组件，所有按钮使用语义化 Button 和 lucide 图标。

**禁止修改：**

- 订单页面、后端文件、根路由、管理员公共导航和全局样式。

### 子代理 C：管理员订单页面与发货

**所有权：**

- `apps/web/src/api/modules/admin-orders.ts`
- `apps/web/src/api/types/admin-orders.ts`
- `apps/web/src/pages/admin-orders/**`

**任务：**

- 实现订单筛选、分页、列表、详情 Dialog 和发货 Dialog。
- 复用现有管理员订单 API 和现有发货字段约束，不在前端复制状态机或库存逻辑。
- 只有 `pending_shipment` 显示发货操作；提交中防重复，成功后刷新详情和列表，409 保留表单。
- 正确处理 401、403、404、409、500/503 和网络错误。

**禁止修改：**

- 商品页面、后端订单模块、根路由和公共导航。

### 子代理 D：前端/后端测试

**所有权：**

- `apps/web/src/pages/admin-products/**/*.spec.ts`
- `apps/web/src/pages/admin-orders/**/*.spec.ts`
- `apps/web/src/api/modules/**/*.spec.ts` 中仅本次新增适配器测试文件
- `apps/api/src/product-catalog/spec/admin-product-catalog.*.spec.ts` 中尚未由 A 创建的测试补充文件

**任务：**

- 覆盖商品 API schema、管理员权限、精确库存投影和分页。
- 覆盖商品页面加载/空/错/详情/过期响应保护。
- 覆盖订单页面筛选、发货按钮可见性、提交中、成功刷新、409 冲突和权限跳转。
- 遵循仓库现有测试基础设施；不临时引入 Vitest、Vue Test Utils 或 Playwright。

**禁止修改：**

- 业务生产代码、根路由、公共配置和依赖清单。

## 主代理所有权与集成职责

主代理独占：

- `apps/web/src/router/index.ts`
- 管理员公共导航或现有账户页中管理员入口的修改
- `apps/web/src/api/types/index.ts`（如需要统一导出）
- `apps/api/src/app.module.ts` 或模块公共注册文件（如需）
- `apps/web/package.json`、根配置和依赖锁文件
- 跨模块文档、最终测试和 Smoke Test

主代理负责：

- 冻结后端响应类型与前端 API 类型映射。
- 接入管理员商品 Controller/Service 到 `ProductCatalogModule`。
- 将商品、订单入口加入管理员导航，增加 `/admin/products`、`/admin/orders` 路由并保留 `adminOnly`。
- 处理分页组件添加、公共类型导出和构建冲突。
- 审查管理员接口是否泄露给普通用户、是否暴露商品 Entity、是否绕过现有订单状态机。
- 集成子代理修改，不覆盖用户未提交工作。

## 实施顺序

### 阶段 0：公共接口冻结

- 用户确认本实施文档。
- 主代理固定管理员商品 API 的 Query、Param、列表响应和详情响应。
- A、B、C、D 阅读冻结接口和错误映射。

### 阶段 1：后端商品接口与 API 类型并行

- A 实现管理员商品查询 API、schema、响应 DTO 和后端测试。
- B/C 按冻结响应定义前端 API 类型和适配器。
- D 编写接口权限、schema 和适配器测试。

### 阶段 2：前端页面并行

- B 实现商品页面。
- C 实现订单页面和发货交互。
- D 补充页面状态与交互测试。
- 子代理不修改根路由和公共导航。

### 阶段 3：主代理集成

- 接入 `ProductCatalogModule` provider/controller。
- 接入管理员路由和导航。
- 必要时通过 shadcn-vue CLI 添加 Pagination，并审阅生成组件。
- 检查所有页面路径、API 路径、响应字段和 `adminOnly` meta 一致。

### 阶段 4：自动化验证与 Smoke Test

- 执行前端类型检查、构建、后端类型检查、后端测试和 `pnpm check`。
- 使用管理员账号验证商品列表/详情、订单列表/详情和待发货订单发货。
- 使用普通用户验证页面路由跳转和管理员 API 403。
- 验证发货后库存、预占和订单状态由后端正确更新；前端不自行推算。

## 验收清单

- [x] 商品和订单页面均使用独立 `index.vue`、`page.ts` 和私有组件目录。
- [x] 商品管理员 API 只读，返回精确库存但不改变普通用户商品接口。
- [x] 商品筛选、分页、详情和异步状态已实现。
- [x] 订单筛选、分页、详情和异步状态已实现。
- [x] 待发货按钮、提交中防重复、成功刷新及冲突输入保留已实现。
- [ ] 已登录浏览器实际交互验证发货后刷新、409 保留输入和失败重试。
- [ ] 管理员权限、普通用户 403、未登录跳转均通过验证。
- [x] 页面不直接调用 Axios、不依赖后端 Entity、不跨页面引用私有实现。
- [x] `pnpm check`、API 测试和前端构建通过。

## 风险与停止条件

- 如果商品精确库存的公开边界发生变化，暂停实现并回到设计/契约确认。
- 如果需要商品编辑、上下架、库存写入或批量发货，暂停当前范围并新增需求审批。
- 如果前端需要新增依赖或测试框架，先提交依赖提案，不在子代理中自行安装。
- 如果后端管理员商品查询无法复用现有库存预占语义，暂停并更新技术文档。
- 如果发现订单发货接口字段或状态机需要变化，回到订单契约阶段，不在页面层绕过。

## 子代理完成报告格式

```text
修改文件：
执行命令：
测试结果：
未解决风险：
越界修改：
```

## 实施与验证记录

- 子代理 A：后端商品管理员查询、Zod/Service/HTTP 和 PostgreSQL 测试。
- 子代理 B：商品页、类型与 Axios 适配器、Dialog 和异步生命周期。
- 子代理 C：订单页、详情及发货表单、类型与适配器、冲突/刷新状态。
- 测试角色 D 在前三项完成后执行只读集成复核，未新增前端测试框架或测试脚本。前端单元/组件测试未落地，不将复核等同于自动化测试。
- 主代理：统一管理员布局、路由/导航、CLI 添加的 Pagination 及共享分页控件、认证失效/角色收回后的统一卸载与跳转、最终验证。
- 没有新增运行时依赖、Entity 或 Migration。商品和订单接口既有响应不变。

已通过：

```bash
pnpm check
pnpm --filter @clothes-shopping-guide/api test
RUN_ADMIN_PRODUCTS_POSTGRES_TEST=1 \
ADMIN_PRODUCTS_TEST_DB=clothes_guide_orders_test_final20261107 \
pnpm --filter @clothes-shopping-guide/api exec tsx --test \
  src/product-catalog/spec/admin-product-catalog.postgres.spec.ts
```

- API 默认测试：169 通过、10 个环境门控专项跳过。管理员商品 PostgreSQL 专项已单独启用并通过。
- 隔离库测试验证：关键字字面匹配、品牌/分类/状态/库存筛选、稳定分页、SKU 价格精度、库存与预占、详情、404、真实 Nest/JWT/RolesGuard 的 401/403/200。
- 真实应用 HTTP Smoke Test 验证：管理员商品和订单详情 200、普通用户管理访问/发货 403、非法发货 400、发货后 `pending_receipt`、相同物流安全重试、不同物流覆盖 409，以及发货后实物/预占库存。
- 浏览器验证仅确认未登录访问管理页跳转到登录页；本机浏览器自动化访问受限，已登录管理员的桌面/窄屏视觉和发货交互尚未完整验证。
- 默认开发数据库未迁移或写入；预览使用独立的 `clothes_guide_orders_test_final20261107` 及明确标注的合成商品、账号和订单。

仍待验证：

- 已登录管理员的桌面/移动布局、详情切换、分页、错误重试和表单焦点。
- 前端 401 刷新失败、403 角色撤销、连续筛选、409 后刷新与成功提交后刷新失败的自动化交互覆盖。
