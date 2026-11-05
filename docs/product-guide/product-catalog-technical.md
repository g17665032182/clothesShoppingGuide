# 商品目录技术文档

## 文档信息

- 状态：技术方案已确认；本轮按补充契约规则同步，待用户复核。
- 关联设计：[服装导购体系设计文档](./product-guide-design.md)。
- 关联契约：[商品目录 CRUD 契约](../contracts/product-catalog-crud-contract.md)。
- 所属应用：`apps/api`、`apps/web`。
- 技术栈：NestJS 12、MikroORM 7.2、PostgreSQL、Zod 4、LangChain/LangGraph、Vue 3。
- 最后更新：2026-11-05。

## 实现目标

新增独立 `ProductCatalogModule`，管理商品及 SKU 导入和查询；以服务端结构化工具把查询能力提供给现有 LLM Graph；聊天模块把安全的商品投影保存到既有公开展示字段；前端在聊天消息中渲染商品卡片和同查询的分页操作。

只复用项目已安装的 NestJS、MikroORM、Zod、LangChain/LangGraph 和现有聊天展示机制，不增加运行时依赖，不引入第二套数据库、管理后台、订单系统或库存锁定。

## 本地能力与依赖

已检查本地实现：

- 请求校验：全局 `StandardSchemaValidationPipe`，DTO schema 使用 Zod `z.strictObject` 并绑定到 Nest 参数装饰器。
- 持久化：`@mikro-orm/decorators/legacy` Entity、`MikroOrmModule.forFeature()` 和显式 MikroORM Migration。
- LLM 工具：`createConfiguredTools()` 通过工具工厂注册工具，`createLlmGraph()` 将工具交给 LangGraph `ToolNode`。
- 聊天展示：现有 `publicDisplay` 投影与来源/活动相关过滤用于受控公开信息；商品卡片需作为明确的白名单展示类型接入，不能直接公开 trace payload。
- 偏好：由 `UserPreferencesModule` 的公开 Reader 端口读取，不跨模块访问其 Entity。

因此无需新增开源库。实现前仍需按项目约定确认相关已安装版本的官方文档，特别是 MikroORM Entity/关系迁移以及 LangChain `StructuredTool` 参数 schema。

## 目录和所有权

```text
apps/api/src/product-catalog/
  product-catalog.module.ts
  index.ts
  controller/                 # 仅当确认提供只读 HTTP 查询端点
  dto/                        # 查询输入的 Zod schema 和导入报告类型
  entity/
    product.entity.ts
    product-sku.entity.ts
    product.mapper.ts
  import/
    product-catalog-importer.service.ts
    product-catalog-import.schema.ts
  query/
    product-catalog-query.service.ts
    product-catalog-query.schema.ts
    product-match-reasons.ts
  tool/
    product-search.tool.ts
    product-tool.provider.ts
  spec/
    ...
apps/api/src/database/migrations/
  Migration<timestamp>.ts
apps/api/src/scripts/
  import-product-catalog.ts
apps/api/fixtures/product-catalog/
  schema-version-1.json
apps/web/src/pages/chat/components/
  ChatProductResults.vue
  ChatProductCard.vue
```

如不提供 HTTP 查询端点，不创建空 Controller/DTO 目录。商品卡片作为聊天页面私有组件留在 `pages/chat/components/`；只有存在两个及以上页面复用后再提升为共享业务组件。

## 数据模型与索引

已确认使用两张表：

### `products`

- UUID 主键。
- `external_id` 唯一且非空。
- 名称、品牌、类别（`tops`、`bottoms`、`dresses`、`outerwear`、`shoes`）、纯文本描述、风格/场合/版型 JSON 标签、适用人群（`adult`）。
- `product_url` 可空，`is_active`。
- 创建和更新时间。

### `product_skus`

- UUID 主键，外键 `product_id` 指向 products，父商品删除策略为禁止物理删除或级联仅由数据库策略明确限定。
- `external_sku_id` 与 `product_id` 组成唯一约束。
- 颜色、尺码字符串、价格（PostgreSQL `numeric(12,2)`，不得使用浮点数计算）、固定币种 `CNY`、非负整数库存、图片 URL、启用状态。
- 创建和更新时间。

Migration 显式创建外键、唯一约束及读取索引。建议索引覆盖有效商品类别和 SKU 父键/状态；具体索引需根据查询 SQL 和 EXPLAIN 校验，避免为 JSON 标签建立未经测量的 GIN 索引。

字段/约束发生变化时先回到设计与契约阶段更新审批，技术文档不替代该审批。名称、描述、标签和 URL 的精确长度仍需在实现前由 schema 定稿。

## 模块依赖与工具注入

依赖方向：

```text
ChatRecordsModule
  -> LlmService (公开调用入口)
  -> ProductCatalog query/tool public port
UserPreferencesModule
  -> UserPreferencesReader public port
ProductCatalogModule
  -> Product/SKU repositories
  -> ProductCatalogQueryService
  -> ProductSearch StructuredTool factory
LlmModule
  -> generic graph and injected StructuredTool[]
```

商品模块不导入 LLM Entity 或 Service。LLM Graph 保持通用，不查询商品数据。工具实例由 Nest composition root 组装后传入 Graph provider；避免在全局静态注册表中构造依赖 Repository 的实例，也避免 `LlmModule <-> ProductCatalogModule` 循环依赖。可采用显式工具工厂 token，由根模块按依赖注入创建工具列表并供 LLM Graph 编译 provider 使用；最终 token/provider 形状应以 Nest 当前模块 API 及现有测试替身验证。

商品搜索工具的 `invoke` 只调用商品查询公开应用服务，并将公开 DTO 作为工具结果。不得返回 ORM Entity、Repository 对象、内部 ID 以外的数据库字段、导入报告或原始 SQL 错误。Tool 结果需要有稳定 schema，供 Graph 后续重建消息及聊天投影。

聊天模块在请求 LLM 前通过公开端口取得用户偏好，并将用户 ID 作为服务端可信上下文提供给商品查询应用服务；工具不接受模型自行指定的用户 ID。当前轮用户明确条件优先于保存偏好。

## 查询与推荐算法

应用服务分两步处理：

1. 规范化并校验查询意图；对明确的尺码、预算和有货要求建立硬过滤。
2. SQL 查询有效商品和 SKU，过滤后按确定性匹配分排序，最后以稳定标识打破并列。

初版只使用离散、可解释的规则分值：类别/尺码/预算/库存用于候选可用性；明确硬条件必须满足；颜色、风格、场合、版型和偏好匹配产生有限标签与排序分。每个分值和标签都由命中的字段推导，禁止让 LLM 生成结构化标签。不得在应用层加载全部商品再排序。

默认 `limit=3`，上限为 20。为使游标续查结果稳定，分页排序键必须是完整且确定的组合。游标包含规范化查询指纹、最后排序键和版本，并使用服务端 HMAC 签名，有效期 15 分钟。非法、篡改、过期或版本不兼容游标返回稳定的无敏感信息错误。

“更多”和“换一批”都按相同排序键的下一页处理，不实现随机排序或排除当前结果集的隐藏规则。

无结果时返回空结果和有限原因枚举，例如 `NO_MATCHING_SIZE`、`OVER_BUDGET`、`OUT_OF_STOCK`、`NO_ACTIVE_PRODUCT`。只有能从实际查询约束确定的原因才可返回；不以模型推测原因，不自动调整筛选条件。

## JSON 导入与 CLI

使用 Node.js 标准文件 API 读取输入，使用 Zod 严格 schema 解析版本化 JSON，不引入 CSV/Excel 解析器。正式 schema 和文件格式字段在 CRUD 契约确认后冻结。

命令只接受明确文件路径及可选 dry-run；不从任意远程 URL 拉取文件。步骤：

1. 读取文件并做大小限制。
2. JSON 解析和完整 Zod 校验；错误路径包含记录索引/字段路径。
3. 检查 `externalId` 和 SKU 外部 ID 在文件内重复。
4. dry-run 只返回新增/更新/状态变化预览，不写库。
5. 正式导入在一个 MikroORM `transactional()` 中按外部标识 upsert 商品及 SKU。
6. 任意数据库异常回滚整个事务；CLI 非零退出。
7. 输出计数和脱敏诊断，不打印整行商品数据。

不依赖 `migration:fresh` 或生产启动自动导入 fixture。Fixture 由专用本地命令显式加载，CI 测试直接使用测试数据库/事务。

文件中没有出现的既存商品不自动下架；只有显式 `isActive: false` 才下架，除非用户重新确认另一种导入模式。该技术建议需在契约确认时一并批准。

## API、schema 与错误

首期查询只由受 JWT 保护的聊天入口调用内部工具，不新增商品 HTTP 查询路由。商品工具的结构化输入单独定义 Zod strict schema，并由 LangChain 工具运行前校验。

导入文件 schema 也用 Zod strict schema，但不是 HTTP 请求，不通过 Nest Pipe。

错误边界：

- 未认证 HTTP 查询：现有全局 JWT Guard 返回 `401`。
- 非法 query/schema 或游标：`400`。
- 商品无结果：成功返回空页而非错误。
- CLI 文件无效或重复标识：非零退出，不写入。
- 数据库异常沿用全局异常过滤器，不返回 SQL、连接信息或完整 Entity。

## 聊天展示持久化

- 工具输出经过明确 allowlist 映射为 `publicDisplay.productResults`，关联本轮 assistant message ID。
- 公开字段限定为商品名称、品牌、分类、有限描述、主图 URL、匹配 SKU 价格/尺码/颜色、匹配理由、详情 URL 和分页操作令牌。
- 不把内部工具参数、完整库存数量、查询 SQL、导入来源、模型生成解释直接复制到公开 payload。
- 价格与库存的卡片语义必须在契约阶段确定；若库存只要求有货判断，前端不展示精确库存数量。
- 历史恢复再次校验 URL 协议、长度、字段 allowlist 和匹配消息归属。
- 商品下架或价格变化后，历史消息保留当时公开的推荐快照，但卡片需按现有聊天历史边界说明是历史响应；详情链接仍由前端展示为外链并做安全属性处理。
- 不能通过 Markdown 内容或任意正文链接反向生成商品卡片。

分页令牌应对应服务端查询状态或签名查询，不允许模型任意构造游标。调用“更多/换一批”时需确保用户、会话、原始消息和查询句柄归属一致。

## 前端实现

- 在聊天页面私有组件目录新增商品结果和商品卡片组件；聊天消息模型增加显式、类型化的 `productResults` 展示块，不在模板中解析工具 trace。
- 商品图片使用固定比例容器和稳定尺寸；加载失败显示现有空图状态，不导致消息布局跳动。
- 外链使用安全 URL 校验和 `target="_blank" rel="noopener noreferrer"`（若当前产品外链约定一致）。
- “更多”和“换一批”通过明确按钮事件通知页面逻辑，由页面层调用聊天后续请求；不由卡片组件散落调用 Axios。
- 复用 `src/api/` 现有客户端请求封装和聊天模块，不新增直接 Axios 调用。
- Loading、无结果、请求错误、过期响应和重复点击状态由聊天页面现有请求状态管理承载。
- 移动端卡片宽度自适应消息正文，不产生横向滚动。

## 安全、可观测性与性能

- 商品查询归属取自认证用户，模型输出的 `userId` 一律不可信。
- 商品链接和图片仅允许绝对 HTTP/HTTPS URL；拒绝用户名密码、相对地址和危险协议。服务端不抓取 URL，不触发 SSRF。
- 描述按纯文本展示，禁止不可信 `v-html`。
- 输入 JSON 文件设置最大字节数、记录数及字符串限制，降低内存和事务占用风险。
- 查询使用数据库过滤、索引和严格 limit；结果工具 token 大小受限。
- 日志只记录导入文件名（必要时脱敏）、新增/更新数量、耗时和错误类别；不记录全量商品内容。
- 数据库错误不会写入模型上下文或公开消息。
- 不新增价格追踪、库存事件历史或复杂缓存；后续按测量结果扩展。

## 测试方案

后端：

- JSON schema：正确版本、未知字段、缺字段、字段边界、非法 URL、重复 external ID/SKU。
- Importer：完整预校验、dry-run 无写入、幂等新增/更新、显式下架、事务失败全回滚和文件缺席商品保持状态。
- Query Service：有效状态、SKU 可用性、硬条件、软排序、并列稳定、空结果原因、limit 和游标绑定/篡改。
- Tool：服务端用户上下文不可伪造、仅返回公开投影、模型未知字段返回工具错误。
- HTTP（若开放）：JWT、Zod strict schema、数值转换、越界、未知字段和 `400` 行为。
- Migration：PostgreSQL 专项验证表、外键、唯一约束和索引。
- 集成：Fake Chat Model 完成 tool call -> 查询 -> ToolMessage -> assistant 输出 -> 持久化公开卡片；不访问真实模型 API。

前端：

- 组件校验图片缺失/加载失败、详情链接缺失、价格和匹配原因展示、分页按钮禁用/提交状态。
- 浏览器级验证聊天推荐、无结果、更多和窄视口不横向溢出；按项目测试基础设施现状先评估可执行手段，不因此临时引入未批准测试框架。

## 验证命令

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
```

涉及迁移时必须在可丢弃的 PostgreSQL 测试数据库审阅 SQL 并执行迁移验证；禁止为普通验证未经确认执行 `migration:fresh`。依赖可控时执行本地 HTTP/浏览器 smoke test，并注明不调用真实 LLM。

## 技术审批待确认

1. Product Tool 与通用 LLM Tool Registry 的 Nest 注入组合方式。
2. 游标签名密钥配置来源和具体载荷编码。
3. 具体匹配标签和无结果原因枚举。
4. 生产商品 JSON 的尺寸/记录数上限和部署环境 CLI 执行方式。
