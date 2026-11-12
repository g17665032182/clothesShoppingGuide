# CRUD 契约

- [用户与认证业务契约](./user-crud-contract.md)：用户注册、登录、JWT 鉴权和管理员用户管理。
- [商品目录 CRUD 契约](./product-catalog-crud-contract.md)：商品/SKU、导入、推荐及订单库存协作增量。
- [订单 CRUD 契约](./order-crud-contract.md)：已确认并实现的下单、模拟支付、库存、履约和查询。
- [管理员运营 CRUD 契约](./admin-management-crud-contract.md)：管理员只读商品查询、精确库存、订单查询与整单发货页面。
- [聊天卡片展示 CRUD 契约](./chat-card-display-crud-contract.md)：设计、技术和实施方案已确认，功能实施中；涵盖通用 `type: card` 协议、模板分发、数据来源和历史兼容边界。
- [聊天购买 CRUD 契约](./chat-purchase-crud-contract.md)：已实现商品卡购买、聊天草稿、确认卡与本人订单入口；审批已完成，验证证据及浏览器验收缺口见[实施文档](../chat-purchase/chat-purchase-implementation.md)。
- [AI 虚拟试穿 CRUD 契约](./virtual-try-on-crud-contract.md)：已确认并进入实现，涵盖商品卡试穿、照片资产、后台任务和本人结果资源；生产真实人像仍受供应商隐私审查阻塞。

新增业务资源前，请参考 `.agents/skills/nestjs-mikroorm-crud/references/crud-contract.md` 在本目录创建契约，完成字段、权限、分页、删除行为和迁移兼容性确认后再实现。
