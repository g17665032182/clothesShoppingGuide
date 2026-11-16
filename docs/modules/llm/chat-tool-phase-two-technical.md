# 对话工具第二阶段技术文档

## 状态与范围

- 状态：2026-11-16 技术方案及[实施文档](./chat-tool-phase-two-implementation.md)均已确认；两个工具已接入，实际验证与缺口见实施记录。
- 日期：2026-11-16。
- 前置确认：用户回复“可以”，批准[第二阶段设计](./chat-tool-phase-two-design.md)及[扩展增量契约](../../contracts/chat-tool-expansion-crud-contract.md)，包括偏好关闭不返回值、两种查询整轮退出自动记忆和摘要来源。
- 关联契约：[商品目录](../../contracts/product-catalog-crud-contract.md)、[用户偏好](../../contracts/user-preferences-crud-contract.md)、[长期记忆](../../contracts/user-memory-crud-contract.md)。
- 验证约定：[环境与验证](../../development/validation.md)、[全量验证计划](../../testing/project-full-validation-plan.md)。

新增 get_product_skus、get_my_preferences 两个只读模型工具。固定每页 5 条、页码 1–10；JSON/SSE 共用工具装配、身份绑定、安全响应和来源隔离。

不新增依赖、HTTP 路由、SSE 事件、前端页面、卡片、Entity、字段、索引、迁移、环境配置或写入权限。第一阶段实现及其未完成验收保持原记录，不能据此宣称第二阶段已验证。

## 依赖与调查依据

2026-11-16 从本地安装清单核对：Zod 4.6.7、LangChain Core 1.3.0、LangGraph 1.5.2、MikroORM Core/PostgreSQL 7.2.5、NestJS Common/Core 12.2.0，沿用现有版本。

| 依据                                                                                                                              | 本次使用方式                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 本地 `zod/v4/classic/schemas.d.ts`，Zod 官方 Defining schemas：`https://zod.dev/api`                                              | 复用 strictObject、default、input/output、严格联合与结果校验，不引入平行校验库                 |
| 本地 `@langchain/core/dist/tools/index.js`、`index.d.ts`，官方 Tools：`https://docs.langchain.com/oss/javascript/langchain/tools` | 使用项目已有 `@langchain/core/tools` 的 tool；框架解析参数后才执行函数，不照搬文档中的新包入口 |
| 本地 MikroORM EntityManager、Connection 类型与 SQL 连接实现，官方 Transactions：`https://mikro-orm.io/docs/transactions`          | 独立 fork、只读 REPEATABLE READ、findAndCount 及 raw execute 显式事务参数                      |
| Context7 的 MikroORM v7.2.5 官方仓库文档                                                                                          | 补充核对 transactional 隔离级别及 fork 上下文规则；具体签名以本地安装版本为准                  |

本地可复用源码：

- `virtual-try-on/service/try-on-task-reader.service.ts`：独立只读快照、安全投影和严格输出。
- `product-catalog/service/product-catalog.service.ts`：有效商品/SKU、颜色尺码匹配、当前规格排序及库存公式。
- `product-catalog/service/product-catalog-purchase.service.ts`：raw SQL 显式传事务上下文、金额字符串校验。
- `user-preferences/context/preference-value.schema.ts`、`preference-safety.ts`：九类类别和值、安全文本扫描。
- `chat-records/tools/chat-user-information.tool.ts`：校验后、第一次 await 前标记整轮资格。

现有 HTTP SKU schema 有数值转换和可变页大小，不能直接给模型使用。购买规格 Port 有事务及全量数量限制，不能用来读取固定数量后过滤。偏好管理列表会间接初始化设置，相关性 reader 会截断候选，两者均不能作为新查询的内部调用路径。

## 目录与公开接口

| 模块             | 新增或调整的文件                                                                                         | 职责                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| product-catalog  | 新增 `dto/product-sku-lookup.dto.ts`、`service/product-sku-reader.service.ts`；调整模块与 index          | SKU 严格输入输出、领域只读查询及公开导出     |
| user-preferences | 新增 `dto/preference-chat-query.dto.ts`；调整现有 reader、port 和 index                                  | 本人偏好明细，复用类别校验且独立于相关性路径 |
| chat-records     | 新增 `tools/chat-product-skus.tool.ts`、`tools/chat-preferences.tool.ts`；调整 Service、trace 和 history | 每轮工具装配、身份与回调、安全历史和追踪     |
| llm              | 调整 `context/system-context.md` 及必要的 shopping-flow                                                  | 查询适用说明、分页上限、失败及只读边界       |
| 各所属模块       | schema/reader/tool spec，聊天相关回归和门控 PostgreSQL spec                                              | 验证输入、领域规则和真实工具链               |

以上为实际实现入口。保留 ESM `.js` 相对导入；必要代码注释使用中文。聊天层不导入其他领域的 Entity、Repository、私有 schema 或存储实现。

公开接口固定为：

```ts
class ProductSkuReaderService {
  listForChat(query: ProductSkuLookupInput): Promise<ProductSkuLookupResult>;
}

interface UserPreferencesReader {
  readContext(userId: string, currentMessage: string): Promise<string>;
  listForChat(
    userId: string,
    query: PreferenceChatQuery,
  ): Promise<PreferenceChatResult>;
}
```

`ProductCatalogModule` 注册并导出 ProductSkuReaderService，其 index 导出 reader、query/result schema 和类型；不改现有 ProductCatalogService.listSkus 的 HTTP 行为。

在现有 UserPreferenceReaderService 增加独立 listForChat 方法，扩展既有 USER_PREFERENCES_READER Port，保留 readContext 行为。现有 useExisting 及模块导出即可复用，无需新增 token 或 Service；index 公开新增 DTO/schema 和类型。类别和值的具体实现仍留在偏好模块内部。

ChatRecordsModule 已导入两个领域模块。ChatRecordsService 注入新的 SKU reader，继续使用现有 preferenceReader；SKU reader 使用运行时类导入及明确的 Nest 注入标识，不依赖 type-only 导入推断。

现有直接构造 ChatRecordsService 和实现 UserPreferencesReader 的测试替身须补齐依赖和新方法，包括聊天服务、首期试穿查询、流式和购买 PostgreSQL 夹具；不能为维持旧测试而把生产依赖改为无实现的可选占位。

## 输入与输出 Schema

### 模型与领域输入

两个 DTO 文件均定义严格 query schema，并分别导出 `z.input` 原始输入及 `z.output` 解析后类型。工具直接使用该 schema；公开 reader 在数据库访问前复用 schema 校验，保护其他内部调用者，不复制另一套手写规则。

| Schema                    | 字段与解析结果                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| productSkuLookupSchema    | productExternalId 必填；color/size 可选；page 可省略，解析后为实际整数                      |
| preferenceChatQuerySchema | category 可省略，复用九类 enum；page 规则同上                                               |
| page                      | `z.number().int().safe().min(1).max(10).default(1)`，拒绝字符串数字、null、小数及非安全整数 |
| 商品标识                  | trim 后 1–160 字符，大小写敏感；拒绝 C0/DEL 控制字符，沿用目录文本规则                      |
| color/size                | trim 后 1–32 字符，同样拒绝 C0/DEL 控制字符，不转换大小写或翻译                             |
| 未知字段                  | z.strictObject 拒绝，包括 userId、conversationId、pageSize、skuId、URL、动作和任意表达式    |

控制字符检查须检查 trim 前原文，避免首尾换行或制表符被 trim 后悄悄接受；普通首尾空格可以移除。不新增兼容归一化规则。此约束只用于新工具，不借此修改既有导入或 HTTP schema。

非法输入在业务错误映射 catch 之前抛出，且不查询数据库。LangChain 在函数前完成模型输入解析；非法工具参数沿用固定工具失败通路，不能透传带原参数的解析异常。

本次没有新增 Body/Query/Param 或 Controller。原聊天 Body 继续绑定 chatSchema 和 Nest StandardSchemaValidationPipe；开流前 HTTP Body 非法为 400，未认证/禁用为 401，会话越权为 404。聊天运行中的模型工具校验失败不承诺改写为 HTTP 400。Swagger DTO 不承担运行时校验。

### 安全结果

结果均为严格成功/失败联合，失败没有额外字段：

- ProductSkuLookupResult：成功 `{ ok: true, productExternalId, items, page, pageSize: 5, total, hasNext }`；失败 `{ ok: false, code: "not_found" | "unavailable" }`。
- PreferenceChatResult：成功 `{ ok: true, items, page, pageSize: 5, total, hasNext }`；失败 `{ ok: false, code: "preferences_disabled" | "unavailable" }`。

共同校验：items 最多 5 条、total 为非负安全整数、pageSize 为字面量 5、hasNext 为布尔值且须等于 `page * 5 < total`；当前页条目数必须符合 total 和 offset，不静默截断、丢弃或填充。空页仍携带真实 total，不能依赖空页不存在的窗口计数。

SKU item 只含 color、size、unitPrice、currency、inStock。颜色尺码为合法的目录短文本；单价保留 PostgreSQL numeric(12,2) 的十进制字符串，不转浮点数，验证非负、两位小数及现有金额范围；currency 固定 CNY，inStock 必须为布尔值。

偏好 item 只含 category、valueType、value、isPrimary、updatedAt。外层严格白名单，value 使用已有 preferenceValueByCategorySchema 校验 category/value 关系，并复用 containsSensitivePreferenceText。允许先在校验内部接收 unknown，但不得将未经校验的 unknown 作为公开输出。valueType 必须等于 getPreferenceValueType(category)；存量字段不匹配时失败，不能覆盖为派生值后冒充成功。updatedAt 为有效 ISO 时间。

领域 reader 显式组装结果并严格校验；工具包装再按白名单投影并校验后 JSON.stringify，不 spread Entity 或管理 DTO。数据库异常、损坏值和输出校验失败固定 unavailable，不输出异常、SQL、敏感命中片段或原始行。不得以不安全条目被跳过后的列表冒充完整结果。

## 只读查询与一致性

### 共用事务边界

每次调用从领域 Repository 的 EM 创建独立 fork：`{ clear: true, useContext: false, keepTransactionContext: false }`。在短事务内使用 `{ isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true }`，结束后才把结果交给模型；不跨模型调用持有事务，不持久化、不修改实体、不初始化设置、不触发任务。

所有 raw SQL 都须传同一个非空 `transaction.getTransactionContext()`：

```ts
await transaction
  .getConnection()
  .execute<Row[]>(sql, parameters, 'all', transaction.getTransactionContext());
```

执行前确认上下文存在，缺失按查询失败处理。仅把 connection.execute 放进 transactional 回调不代表 SQL 自动加入该事务；不得省略第四参或使用原 request EM 的连接上下文。只拼接服务端固定筛选片段，输入值全部绑定参数，不拼接用户文本。

只读事务可能执行 ORM 自身的提交处理，但服务不调用 flush/persist/nativeUpdate，不持有待写实体；独立 identity map 和数据库 read-only 共同保证不能带入原请求的写入。错误使本次短事务结束，不影响下一轮普通聊天。

### SKU 查询步骤

1. 同一快照按 external_id 精确匹配有效商品，不存在/停用返回 not_found。
2. 针对该商品的有效 CNY SKU 构造完整条件；color 和 size 分别使用 `lower(s.color) = lower(?)`、`lower(s.size) = lower(?)`，同时提供时取交集。
3. 用该条件独立 count；读取 count 的文本结果并验证安全整数，不能把坏计数当作零。
4. 用相同完整条件关联既有 active_order_sku_reservations 视图，按 s.id ASC，limit 5、offset `(page - 1) * 5`。仅选择响应所需列，库存表达式只返回布尔值。
5. inStock 沿用 `(s.stock - coalesce(r.reserved_quantity, 0)) > 0`；不锁库存、不创建预占、不改订单，不把无匹配解释为无货。
6. 显式组装安全结果，计算 hasNext。相同颜色尺码的不同 SKU 保留独立条目，不选价、不合并。

商品、总数、页面及预占状态来自同一快照；新调用读取新快照。跨页聊天不提供冻结目录承诺，下单仍重新校验。过滤和计数不能转移到聊天层，也不能复用购买 Port 的固定全量上限。

### 偏好查询步骤

1. 独立快照内直接 findOne 本人的 UserPreferenceSetting，只读取 enabled。缺行按 true，不调用 getSettings。
2. enabled 为 false 立即返回 preferences_disabled；不查询偏好条目或 total，也不恢复旧任务。
3. 完整过滤条件为本人 userId、status ACTIVE、deletedAt null 及可选 category。用同一个事务 EM 的 findAndCount 查询。
4. 排序为 isPrimary DESC、updatedAt DESC、id ASC；limit 5、offset 同上。只选择 category/valueType/value/isPrimary/updatedAt，以及 ORM 和排序所需内部主键，主键不进入 DTO。
5. 当前页逐项执行严格值、安全文本、valueType 及时间校验；全部通过才返回成功。total 统计符合本人/有效状态/类别的记录，不全库扫描并重写存量数据；当前页损坏时整次 unavailable。

开关与本次列表在同一快照。之后关闭不会撤回已输出正文，新调用必须重新检查。独立 Markdown 记忆开关不影响此读取，本人 CRUD 也继续可用。

## 工具装配与来源资格

两个工厂位于 chat-records/tools，分别创建 get_product_skus 和 get_my_preferences。工厂接收领域 reader、服务端用户参数（仅偏好需要）和 onRequested 回调；不把用户、会话、事务或动作字段放入模型 schema。

ChatRecordsService.tools 在每轮组装时传入 `prepared.persistedConversation.userId`，两种传输使用相同工厂。schema 解析通过进入函数后，在第一次 await 前调用 onRequested，再查询领域。失败、空页、not_found、disabled 都保留标记；重复或并行调用仅将本轮布尔值设为 true。

PreparedChat 新增 `detailQueryRequested: false`，只供本阶段两种查询使用；保留第一阶段 tryOnTasksRequested，避免顺带重构原流程。persistChat 的 eligible 在现有购买状态、purchaseToolUsed、tryOnTasksRequested 及指纹条件上再加 `!prepared.detailQueryRequested`。

资格、两条 ChatMessage、展示绑定及记忆入队判断仍处于既有事务。eligible 为 false 不 enqueue，SSE done 必须在保存完成后发出。已有 source reader、摘要资格和缓存候选重试复用该字段，不能仅跳过当前 enqueue 却允许后续任务重新读入。

不根据模型回复正文猜测是否查询；不使用全局变量或跨用户共享状态。不注册 cardSources，不生成卡片、表单或购买授权。原商品搜索每轮一次的限制保持，新规格工具不增加搜索结果或把查询变为草稿选择。

## 追踪、公开历史与提示词

trace writer 给两个工具增加专用白名单投影：

| 位置                     | 允许记录                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| 工具调用                 | 合法 page；偏好 category；SKU 的 hasColor/hasSize 布尔标记，不含文本和商品标识            |
| 工具结果 content/payload | ok、itemCount（0–5）、非负安全整数 total、合法 page、pageSize 5、hasNext，或对应固定 code |
| model_response 嵌套调用  | 有界 call id、固定工具名、允许的调用类型及上述安全参数                                    |
| SSE activity             | 既有工具名、执行状态，input/output 保持 null                                              |

独立 tool_call、tool_result content、tool_result payload，以及嵌套 toolCalls/tool_calls/invalid_tool_calls 都必须覆盖。嵌套 args 为 JSON 字符串时先安全解析，失败只给空投影；不得回退原始输入，也不得让额外 arguments/input/error 字段被通用序列化保留。固定工具执行失败文本沿用现状，不记录原始异常。

原始业务实体不得进入运行工具结果。传给模型的是严格安全 DTO；持久化 trace 副本则进一步删除条目和筛选文本。既有 input 与最终 assistant 正文仍按原聊天持久化规则处理，不能承诺正文中的用户文本或模型摘要全部消失。

history mapper 的隐藏工具集合新增这两个名字，和第一阶段一样成对隐藏调用及对应结果，不改旧消息格式或公开展示 envelope。后续轮次不能从计数 trace 重建偏好清单或库存事实，需要时重新查询。

服务端实际加载的 system-context.md 及工具 description 同步说明：明确查询意图、唯一商品来源、颜色尺码精确匹配、分页上限、偏好关闭、失败不等于无记录/无货、查询不授权写入。不得只添加文档链接而不进入 SYSTEM_CONTEXT；不新增意图路由器或分类模型。

## 验证方案

以下为验证要求，实际命令、结果及未执行项见[实施记录](./chat-tool-phase-two-implementation.md)。

| 层次            | 必须覆盖的证据                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 输入 schema     | 省略 page、trim、九类、0/11/小数/字符串数字/null、控制字符、空值、未知身份/动作字段；非法输入无查询                                         |
| SKU 领域        | 匹配位于原默认页之后、超过 100 条累计规格、大小写匹配、颜色尺码交集、同色同码不同价、停用、无 CNY/无匹配、无货、空页真实 total              |
| 偏好领域        | 本人/他人、active 与删除双条件、九类安全值、valueType 不符、敏感/损坏条目、主偏好和同时间稳定排序、缺行默认 true 且不建设置                 |
| 工具及编排      | 回调早于 await，成功/空/disabled/not_found/unavailable 均标记，JSON/SSE 同一用户，严格二次输出，下一普通轮恢复                              |
| trace/history   | 独立/嵌套/非法工具调用及 result payload，无商品标识/筛选文本/偏好值/ID/图片；activity null，历史调用结果成对隐藏                            |
| 记忆/摘要       | 两条消息 false、无入队、混合批次、旧候选重试、实际消息/trace ID 绑定、跨轮摘要不重新读入                                                    |
| PostgreSQL/HTTP | 真实 read-only/RR、原生 SQL 事务绑定、并发快照、预占后可售、缺设置无写入、JWT 401/400/404、实际 ToolNode/fake 模型收到安全结果、提交后 done |
| 兼容与浏览器    | 原推荐/购买/地址/表单/订单/试穿自动化；登录态桌面及窄屏查询、空/失败/重试、账号/会话切换、原管理页                                          |

门控集成入口为 `chat-records/spec/chat-tool-phase-two.postgres.spec.ts`，使用 `RUN_CHAT_TOOL_PHASE_TWO_POSTGRES_TEST=1` 和 `CHAT_TOOL_PHASE_TWO_TEST_DB`，测试显式将库名赋给 ORM dbName，要求 `clothes_guide_chat_tool_phase_two_test_*` 且不同于默认库。库名、文件所有权、实际命令及清理见[实施记录](./chat-tool-phase-two-implementation.md)。

只在已确认归属的全新可销毁库应用既有增量迁移，不运行默认库 migration:fresh。复用既有 Nest/JWT/fake model/ToolNode harness，只装测试所需 provider，不启动完整应用 Worker、存储或真实供应商。仅清理本轮 fixture、进程及确实由本轮新建的库；库、迁移、HTTP 端口及构建资源串行使用。

浏览器需受控 fake 模型和隔离配置；没有安全 harness 时明确记为未执行，不临时接真实模型补验收。数据库假模型链路、单测和构建不能冒充浏览器或真实模型测试。

代码实施后的检查沿用：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
git diff --check
```

实施时再记录实际命令、通过/失败/跳过数量、隔离库及清理结果。全仓格式若被无关既有文件阻塞，报告并保留该文件，定向格式检查及独立类型/构建结果分别记录，不重复声称全仓通过。

## 审批与下一步

2026-11-16 用户回复“确认”批准本文。技术选择为独立 SKU reader、扩展现有偏好 reader Port、两者各自短只读一致性快照、严格双层投影、每轮回调及既有来源资格隔离；没有新增业务权限或待确认的数据结构变化。

风险集中于 raw SQL 事务绑定、存量偏好校验失败、现有测试替身接口适配及浏览器 harness 缺口，均已列入验证要求。第二阶段[实施文档](./chat-tool-phase-two-implementation.md)已获用户确认，agent team 已按独占文件实施；具体取证与剩余缺口见其执行记录。
