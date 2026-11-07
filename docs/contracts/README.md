# CRUD 契约

- [用户与认证业务契约](./user-crud-contract.md)：用户注册、登录、JWT 鉴权和管理员用户管理。
- [商品目录 CRUD 契约](./product-catalog-crud-contract.md)：商品/SKU、导入、推荐及订单库存协作增量。
- [订单 CRUD 契约](./order-crud-contract.md)：下单、模拟支付、库存、履约和查询；待用户确认，尚未实现。
- [管理员运营 CRUD 契约](./admin-management-crud-contract.md)：管理员只读商品查询、精确库存、订单查询与整单发货页面。

新增业务资源前，请参考 `.agents/skills/nestjs-mikroorm-crud/references/crud-contract.md` 在本目录创建契约，完成字段、权限、分页、删除行为和迁移兼容性确认后再实现。
