# 商品试穿配置技术文档

## 状态与目标

- 状态：原试穿开关已实施；商品试穿图片上传的技术与实施文档于 2026-11-09 获用户确认，正在实施。
- 日期：2026-11-09。
- 依据：已确认的[设计](./product-try-on-setting-design.md)和[CRUD 契约](../../contracts/product-try-on-setting-crud-contract.md)。
- 目标：管理员上传商品级试穿图片并配置开关，商品卡按当前资格显示入口，服务端拒绝关闭商品的新任务。
- 图片上传增量获用户确认的行为规则：[设计](./product-try-on-setting-design.md)、[CRUD 契约](../../contracts/product-try-on-setting-crud-contract.md)。
- 依据已确认的[实施文档](./product-try-on-setting-implementation.md)开始实施。

## 本地能力与文档

已核对现有 NestJS 12、Zod 4、MikroORM 7.2.5、PostgreSQL、Vue 3、
Axios、Reka UI 和 vue-sonner，无需引入新业务库或全局状态管理。
沿用 NodeNext 的 `.js` 相对导入写法及现有模块公开入口。

界面复用现有 Dialog、Field、Button、Spinner 和全局 Sonner；
Switch、Input 均已安装，本增量复用现有组件。
组件方案沿用 `reka-nova`、Tailwind 语义色和 `@lucide/vue`。
只包含一个布尔设置，不增加表单框架或前端测试依赖。

已执行 `pnpm dlx shadcn-vue@latest docs switch field dialog sonner` 获取官方文档地址。
官网直接抓取受当前网络解析限制，Switch/Field 用法通过 Context7 官方文档索引核对，
MikroORM 事务、锁及冲突字段选项按 7.2.5 官方文档索引核对。
Nest 参数校验同时核对了本地 `StandardSchemaValidationPipe` 实现及现有测试。

参考入口：

- `https://shadcn-vue.com/docs/components/switch`
- `https://shadcn-vue.com/docs/components/field`
- `https://shadcn-vue.com/docs/components/dialog`
- `https://shadcn-vue.com/docs/components/sonner`
- `https://github.com/mikro-orm/mikro-orm/blob/v7.2.5/docs/docs/transactions.md`
- `https://github.com/mikro-orm/mikro-orm/blob/v7.2.5/docs/docs/entity-manager.md`

## 目录与职责

| 位置                                                             | 变更职责                                   |
| ---------------------------------------------------------------- | ------------------------------------------ |
| `product-catalog/entity/product.entity.ts`                       | 默认关闭的商品字段                         |
| `product-catalog/dto/admin-product-try-on.dto.ts`                | 更新请求 schema、派生类型与 Swagger 元数据 |
| `product-catalog/dto/admin-product-response.dto.ts`              | 管理员列表和详情增加保存的设置             |
| `product-catalog/controller/admin-product-catalog.controller.ts` | PATCH 接口和文档装饰器                     |
| `product-catalog/service/admin-product-catalog.service.ts`       | 管理查询和事务内更新                       |
| `product-catalog/service/product-catalog-try-on.service.ts`      | 统一资格计算、单商品和批量投影             |
| `product-catalog/port/product-catalog-try-on.port.ts`            | 扩展跨模块公开事实端口                     |
| `product-catalog/service/product-catalog.service.ts`             | 搜索和分页返回当前可试穿标记               |
| `product-catalog/service/product-catalog-import.service.ts`      | 导入时排除管理员字段覆盖                   |
| `virtual-try-on/service/try-on-task.service.ts`                  | 在创建任务前校验设置与资格                 |
| `chat-records/display/`                                          | 类型、旧快照解析及历史读取时的资格校正     |
| `database/migrations/`                                           | 字段增量迁移及 ORM 快照                    |
| `apps/web/src/api/types/`、`api/modules/`                        | 类型、PATCH 适配器与响应校验               |
| `apps/web/src/pages/admin-products/`                             | 设置草稿、保存状态和详情组件绑定           |
| `apps/web/src/pages/chat/components/ChatProductResults.vue`      | 按标记控制试穿按钮                         |

商品事实仍由 `product-catalog` 所有；其他模块通过其 `index.ts` 导出的 Token 和类型协作。
不把设置写入试穿 Entity，不让聊天或前端依赖商品私有 Entity、Repository。

## 持久化与导入

`Product.tryOnEnabled` 映射 `products.try_on_enabled`，布尔、非空、默认 `false`，
Entity 初始化值也为 `false`。图片增量新增 nullable `products.try_on_image_key`；
不向管理员响应暴露对象键，目录导入冲突更新必须排除该字段。

任务新增 nullable `try_on_tasks.garment_image_object_key`，在所选颜色没有 SKU 图片、
改用商品级试穿图时保存对象键快照；`garment_image_url` 继续用于既有目录图片。
新增 Migration 仅增加上述 nullable 字段，不增加查询索引，不修改既有数据标识、库存或历史结果。
迁移文件由现有 CLI 生成，审查 SQL 和快照后再应用。

导入 JSON v1 不增加字段；导入 `upsert` 的冲突排除字段明确包含 `tryOnEnabled`，
避免 Entity 默认值或后续导入调整将已有配置清零。
新行使用默认关闭；冲突更新保持数据库中的管理员设置，不读取旧值后重新覆盖。
测试 Seeder 沿用同一导入入口。

## 统一资格投影

扩展现有 `ProductCatalogTryOnPort`：

- `getTryOnProduct(externalId)` 保持单商品读取能力。
- 增加批量 `getTryOnProducts(externalIds)`，按外部 ID 返回商品事实映射。
- 投影增加 `tryOnEnabled`（保存值）、`tryOnEligible`（目录资格，不包含保存值）
  和内部 `tryOnImageObjectKey`（商品图对象键，不对前端透出）。
- 对外卡片标记为两者同时为真；管理员仍读取原始保存值。

具体服务集中完成查询、图片规范化和资格计算；模块内调用可复用同一事务的 EntityManager，
跨模块端口不暴露 EntityManager、Entity 或查询表达式。
单商品方法复用批量实现，不单独维护另一套规则。
参数按集合去重，空集合直接返回；单批最多 200 个 ID，调用方对较大集合分块处理。

资格沿用完整商品事实，不受当前搜索预算、尺码或有货筛选影响：

1. 商品有效且为四种支持的服装品类。
2. 存在有效 CNY SKU，其颜色 trim 后非空。
3. SKU 图片经现有 `normalizeProductPublicUrl` 处理，拒绝凭据、私网和保留地址。
4. 同色多个尺码共用一项颜色事实，优先可用颜色图片，无图时回退到商品级试穿图片。
5. 至少一个有效颜色能够取得 SKU 图片或商品级试穿图片即满足目录资格；不验证尺码合身，不请求远端图片。

停用或不存在商品不进入公开映射；鞋类可保留为事实，但资格为假。
管理员开启停用商品直接拒绝，关闭无需资格校验。
不将 Qiniu 状态、供应商模型、全局开关或用户额度混入商品设置。

## 管理员更新与请求校验

接口固定为 `PATCH /api/admin/product-catalog/products/:id/try-on`。
复用当前 JWT、账号状态校验、`RolesGuard` 和 `@Roles(UserRole.ADMIN)`。

| 输入  | Schema 与类型                                           | 规则                                            |
| ----- | ------------------------------------------------------- | ----------------------------------------------- |
| Param | 复用 `adminProductIdSchema` 及其输出类型                | 严格对象，UUID `id`                             |
| Body  | `adminProductTryOnUpdateSchema`，`z.infer` 派生输入类型 | `z.strictObject({ tryOnEnabled: z.boolean() })` |
| Query | 无                                                      | 不读取 Query 作为设置或权限来源                 |

Body 无默认值、转换或可空语义；字符串、数字、缺字段、未知字段均拒绝。
Controller 分别绑定 `@Param({ schema })` 与 `@Body({ schema })`，
由现有全局 `StandardSchemaValidationPipe` 映射为 400；不新增 Pipe 或手写重复解析。
Swagger 请求类和响应类只提供文档元数据。

Service 使用独立 fork 的 EntityManager 开启事务：

1. 按 UUID 读取商品并加悲观写锁，不存在返回 404。
2. 开启时通过同一事务读取目录事实，资格不足返回既定 409 业务码。
3. 只赋值开关与更新时间并 flush，重复相同设置安全成功。
4. 提交后返回管理员详情投影，禁止直接返回 Entity。

管理员查询 SQL 与 Mapper 增加原始字段；精确库存权限、过滤和分页保持现有行为。
同一商品管理员写入由行锁串行，最后一次成功提交生效。
资格以事务内读取的目录事实为准；后续导入改变事实后，公开资格重新计算。
不引入跨模块长事务或全局商品锁。

## 商品级图片上传与对象存储

商品目录模块新增独立私有图片存储端口与 Qiniu 适配器，复用现有 `QINIU_*` 配置，
对象键限定在独立 `product-try-on/{productUuid}/{assetUuid}.webp` 命名空间；
不扩展或放宽现有人像照片/结果对象键校验。对象保持私有，数据库只保存对象键。
图片限 JPEG、PNG、WebP，上传上限 10 MiB、最长边 4096 像素，拒绝动画与无法解码内容；
服务端使用现有 `sharp` 依赖自动旋转、剥离 EXIF 并标准化为 WebP。

| 方法与路径                                                  | 输入/响应                                                                   | 认证和错误                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /api/admin/product-catalog/products/:id/try-on-image` | 严格 UUID Param；multipart `file`；成功返回管理员详情 `hasTryOnImage: true` | 现有启用管理员 Guard；400 图片无效/过大，401/403/404 沿用现有语义，409 已存在商品级试穿图，503 对象存储不可用 |
| `GET /api/admin/product-catalog/products/:id/try-on-image`  | 严格 UUID Param；返回 `image/webp` 二进制                                   | 仅启用管理员；不返回签名 URL 或对象键，设置 `Cache-Control: private, no-store`                                |

上传 Controller 放在 `product-catalog` 模块；Multer 只在内存暂存并设置明确 file-size limit，
真实图片格式、尺寸及动画检测由处理服务按文件内容完成。路径参数沿用现有 UUID Zod schema；
multipart 文件不是 JSON schema，内容校验集中在商品试穿图片处理服务。
服务先检查商品并加锁确认未保存过图片，上传对象成功后再保存对象键；数据库失败时尝试删除本次对象，
不返回上游错误或凭据。没有可用 SKU 图片时详情弹框显示上传控件；已有试穿图片则显示受鉴权预览。
一期已确认不提供移除或替换入口，以避免任务中的图片快照失效和无引用对象泄漏；
若后续用户要求支持替换，必须先设计旧对象保留与任务引用后的清理策略，
不能直接覆盖对象键。

`ProductCatalogModule` 导出仅供 API 内模块使用的 `PRODUCT_TRY_ON_IMAGE_STORE` 端口，
接口提供上传、读取 Buffer 和删除补偿操作，不导出到前端 API 类型。
试穿 Worker 注入该端口读取任务图片对象键；SKU 目录图片仍使用既有 HTTPS 下载。
商品级私有图经 Worker 读取后作为服装二进制送入既有图片规范化与供应商流程，
不会生成或向供应商传递长期签名 URL。

当前 Qiniu 下载域名的 TLS 证书不匹配仍按 TLS 校验失败处理，不设置 `rejectUnauthorized: false`。
若配置问题仍存在，预览/任务读取按稳定服务不可用错误失败，不静默降级为公开对象或不安全本地路径。

## 搜索、历史与任务准入

商品查询完成分页和排序后，针对本页商品一次批量补充当前资格，
不为每张卡片追加查询，也不改变商品价格、排序、游标签名或是否返回该商品。
前后端 `ChatProductCard`、商品结果类型及严格响应 schema 同步增加布尔字段。

历史解析在 `productCardSchema` 对缺失字段使用默认 `false`；
非法类型仍拒绝，不静默将字符串转为布尔。
`ChatDisplayService.read` 恢复完当前页快照后，收集所有商品外部 ID，
通过公开端口批量校正返回 DTO 的标记，禁止回写已保存的 `publicDisplay`。
仅修改试穿标记；名称、价格、图片、购买引用和其他历史数据保持原快照。
解析默认关闭与读取后的当前资格校正是两个步骤，旧快照也可在当前商品开启后获得入口。

资格读取异常时，历史商品的试穿标记统一降为 `false`，记录不含载荷的安全日志；
聊天文字和其余历史展示继续返回。商品搜索与任务创建则沿用现有请求失败处理，
不能把数据库异常伪装为“商品不存在”。
不为每个历史卡片增加 HTTP 请求，不增加新的公开资格接口、缓存或定时轮询。

`TryOnTaskService.create` 在现有目录读取后校验保存值、资格和当前所选颜色图片：
关闭或不具资格返回 `409 PRODUCT_NOT_TRYON_SUPPORTED`；
颜色不存在沿用 `COLOR_UNAVAILABLE`，所选颜色 SKU 图和商品级私有图均不可用时不接受任务。
校验必须发生在照片绑定和任务写入前，事务失败不产生持久化副作用。
请求不增加客户端开关字段；拒绝时不调用供应商、不增加成功次数。

关闭与创建任务并发时，以商品事实读取的准入时点为边界；
已通过准入的任务继续执行，不新增取消能力或 Worker 二次开关检查。
全局配置、同意版本、额度、照片归属及开发白名单检查继续独立执行。

## 前端状态和组件

复用 `admin-products/page.ts`，新增商品级草稿、提交状态、错误和请求取消管理。
提交状态使用 `idle` / `loading` / `success` / `error`；列表和详情保留现有状态模型。
草稿只在详情成功载入时初始化，不放入 Pinia 或全局模块。

详情组件通过类型化 Props 接收草稿、保存状态和禁用原因，
通过 `update:tryOnEnabled` 和 `save-try-on` Emits 通知父页面，不修改商品 Props。
用 `FieldGroup`、水平 `Field`、关联标签和 Switch 展示设置，保存按钮复用 Button 和 Spinner。
不新增套卡片、不改变现有详情 Dialog 的焦点和标题行为。
根据已返回的商品状态、品类和 SKU 图片事实派生禁用原因，后端仍为最终权威。
若原保存值为开启但资格已失效，仍允许切换关闭；关闭后不能重新开启。

新增 Axios 适配器通过 `apiRequest` 发送 PATCH 与 multipart POST；
详情响应校验 `tryOnEnabled`、`hasTryOnImage` 布尔值。预览经带认证的 Axios 请求读取为 Blob，
页面创建对象 URL 并在关闭详情、切换商品或卸载时 revoke；不使用带凭据的图片 URL 参数。
无变更或提交中禁止保存；保存成功才更新服务端快照和列表，并触发一次成功 Toast。
保存失败保留草稿，经现有 `useErrorToast` 提示；不重复增加页面错误横幅。
请求结果未知时允许重新读取详情确认，不假定服务器已回滚。

独立保存 AbortController 与版本号；关闭、切换商品或卸载时取消并使旧版本失效。
异步更新前校验当前商品 ID、请求版本、取消和卸载状态，旧响应不能更新新详情或弹 Toast。
取消客户端请求不代表服务器未写入，再次打开商品必须读取服务端状态。
保存成功刷新列表时继续沿用列表取消与版本保护。

商品卡增加布尔标记判断并保留品类保护，不把路由参数当作权威准入。
当前已打开的聊天不实时刷新配置；重新读取后校正入口，旧链接仍由创建任务接口拒绝。
“我的试穿”的历史、下载与删除不依赖当前商品开关。

## 验证方案

| 层次           | 必须覆盖                                                                      |
| -------------- | ----------------------------------------------------------------------------- |
| Schema 与 HTTP | true/false、缺字段、未知字段、错误类型、非法 UUID，以及真实 Nest 400          |
| 权限           | 启用管理员成功、普通账号 403、未认证与禁用账号 401                            |
| 商品更新       | 开关往返、重复保存、404、鞋类/停用/缺颜色/缺图片拒绝、失效后关闭              |
| 图片上传       | 管理员鉴权、格式/大小/像素/动画边界、重复上传拒绝、上传/DB 失败补偿、私有预览 |
| 资格与卡片     | 多颜色图片回退、无库存可试穿、设置与资格组合、分页排序不变                    |
| 历史展示       | 缺字段不丢消息、开启后可展示、关闭后隐藏、资格故障降级、价格图片不改写        |
| 任务           | 旧链接与伪造参数不能绕过、拒绝无副作用、已接受任务继续、所选颜色图片校验      |
| 导入与数据库   | 新旧商品默认关闭、重复导入保留设置、并发保存、迁移保留商品/SKU/库存           |
| 浏览器         | Dialog 开关保存、Toast、防重复、失败保留草稿、切换商品隔离、桌面和移动布局    |

后端测试沿用 `node:test` 与 `tsx`，放在对应业务 `spec/` 目录；
数据库验证使用命名的可销毁库，先迁移再注入夹具，结束清理夹具并删除该测试库。
现有管理员数据库测试使用 `RUN_ADMIN_PRODUCTS_POSTGRES_TEST=1` 和
`ADMIN_PRODUCTS_TEST_DB`；新增迁移验证必须使用独立库名保护及清理逻辑。
不对用户数据库执行 `migration:fresh`。
浏览器验证复用可用的外部 Playwright 运行环境，不安装前端测试框架或新增测试脚本。
单元与浏览器测试不调用真实生成供应商、不上传真实用户照片。

实施后的检查命令：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm check
```

除上述常规命令外，必须实际执行隔离数据库用例并报告门控测试的执行/跳过情况。
文档阶段只运行文档格式、链接和差异检查，不将计划中的测试写成通过。

## 风险与后续阶段

- 存量商品迁移后全部关闭，管理员需要逐件开启；不自动批量启用测试商品。
- 已打开的旧卡片可能短暂显示旧入口，任务接口始终以服务端准入为准。
- 图片通过静态安全规则不等于外部网络必定可用，下载失败继续走既有任务错误流程。
- 当前本地七牛 HTTPS 下载域名证书不匹配，属于完整生成链路的独立阻塞；
  本增量不绕过 TLS、不改变私有空间配置，也不能据此宣称真实生成已通过。
- 图片上传技术与实施方案已于 2026-11-09 获用户确认；一期上传后不提供替换/移除入口。
