# 个性化商品与穿搭推荐技术文档

## 文档信息

- 状态：已确认；实施中
- 关联设计：[个性化商品与穿搭推荐设计文档](./fashion-personalization-design.md)
- 关联契约：[个性化商品与穿搭推荐 CRUD 契约](../../contracts/fashion-recommendation-crud-contract.md)
- 所属应用：`apps/api`、`apps/web`
- 技术栈：NestJS 12、MikroORM 7.2、PostgreSQL、Zod 4、LangChain/LangGraph、Vue 3
- 最后更新：2026-11-22

用户已于 2026-11-22 确认本文技术方案和实施文档，并确认设计文档中的推荐取向。候选数量、卡片协议、反馈生命周期和任务策略按实施文档决策冻结；在线来源授权仍不在本次范围。

本文定义已实施的技术方案。首期同时支持单品和整套方案，每轮最多返回 2 套、每套 2–4 个可验证商品项；在线商品 API/MCP 首期保持关闭，拼多多和淘宝列为后续优先候选。

## 实现目标

实现一条服务端拥有事实、可插拔商品来源、可解释排序的推荐链路：

```text
当前消息 + 允许的偏好/记忆上下文
  -> 推荐意图工具
  -> 推荐编排器
  -> 商品来源 Port
  -> 统一商品投影
  -> 硬条件过滤与确定性排序
  -> 穿搭组合器
  -> 请求级来源登记
  -> 受控推荐卡片
  -> assistant 消息持久化
  -> 用户反馈
  -> 个人画像任务
```

推荐模块不拥有商品主数据，不抓取任意网页，不让模型填写商品事实，也不把推荐画像写回 `user-preferences` 或 `user-memory`。

## 本地能力与依赖调查

已确认可复用的本地能力：

- `product-catalog` 已有商品/SKU 查询、库存判断、价格投影、匹配理由和分页游标。
- `ChatRecordsService` 按请求装配 LangChain 工具，并通过 `ChatDisplayService` 管理公开投影。
- `chat-card-display` 已有来源登记器、商品卡片协议、SSE `card` 事件和历史恢复边界。
- `user-preferences` 和 `user-memory` 已分别导出只读 Reader Port。
- Zod 4、全局 `StandardSchemaValidationPipe`、MikroORM 事务和现有任务租约模式均已在项目中使用。

首期不新增运行时依赖，不引入向量数据库、推荐系统 SaaS、网页抓取器或新的队列产品。在线来源只允许通过后文定义的 Port 接入；供应商 SDK/MCP 客户端必须封装在独立适配器内，不能进入推荐领域服务。

## 包和目录结构

后端新增模块，目录只保留有实际职责的文件：

```text
apps/api/src/fashion-personalization/
  fashion-personalization.module.ts
  index.ts
  controller/
    fashion-recommendation.controller.ts
  dto/
    recommendation-intent.dto.ts
    recommendation-feedback.dto.ts
    recommendation-settings.dto.ts
    recommendation-profile-response.dto.ts
  entity/
    recommendation-group.entity.ts
    recommendation-feedback.entity.ts
    recommendation-profile.entity.ts
    recommendation-setting.entity.ts
    recommendation-profile-task.entity.ts
  port/
    fashion-recommendation.port.ts
    recommendation-product-source.port.ts
  source/
    local-product-catalog.source.ts
    online-product-source.adapter.ts
  service/
    recommendation-orchestrator.service.ts
    outfit-composer.service.ts
    recommendation-source-registry.service.ts
    recommendation-group.service.ts
    recommendation-feedback.service.ts
    recommendation-profile.service.ts
    recommendation-settings.service.ts
  task/
    recommendation-profile-scheduler.service.ts
    recommendation-profile-task.service.ts
    recommendation-task-lease.ts
  context/
    recommendation-intent.schema.ts
    recommendation-source.schema.ts
    recommendation-target.schema.ts
    recommendation-safety.ts
  spec/
    ...
```

聊天模块只依赖 `fashion-personalization/index.ts` 导出的 Port 和类型，不引用上述 Entity、Repository 或私有 Service。

前端按现有聊天结构增量修改：

```text
apps/web/src/api/
  modules/fashion-recommendation.ts
  types/fashion-recommendation.ts
apps/web/src/pages/chat/components/
  cards/ChatOutfitRecommendationCard.vue
  ChatRecommendationFeedback.vue
apps/web/src/pages/account/
  recommendation-settings/   # 具体页面位置待现有路由调查确认
```

推荐卡片模板仍属于聊天页面，不提升为全局共享组件，除非后续至少有两个业务页面复用。

## 模块边界与依赖注入

### 依赖方向

```text
ChatRecordsModule
  -> FashionPersonalizationModule public Port
  -> ProductCatalogModule public recommendation Port
  -> UserPreferencesReader
  -> UserMemoryReader
  -> LlmService

FashionPersonalizationModule
  -> ProductCatalog public Port
  -> its own repositories/entities
  -> optional online source adapter

ProductCatalogModule
  -> Product/SKU repositories
  -> no dependency on fashion-personalization
```

推荐模块不能注入 `ProductCatalogService` 的私有 Repository 依赖来绕过公开边界。首期需要在 `product-catalog` 增加一个只读公开 Port 或应用投影方法，返回推荐所需的商品事实；具体 token 名称在实施前按当前模块导出风格确定。

### 推荐模块对聊天的公开 Port

建议导出：

```ts
export const FASHION_RECOMMENDATION_PORT = Symbol(
  'FASHION_RECOMMENDATION_PORT',
);

export interface FashionRecommendationPort {
  createRequestScope(input: {
    userId: string;
    conversationId: string;
    currentMessage: string;
  }): RecommendationRequestScope;
  registerPersistedGroup(
    entityManager: EntityManager,
    input: PersistRecommendationGroupInput,
  ): Promise<void>;
}
```

`RecommendationRequestScope` 只存在于一次聊天请求，保存推荐草稿、来源引用和待展示目标；它不持有 ORM Entity，不写全局缓存。`registerPersistedGroup` 只在 assistant 消息和公开展示投影准备写入同一个事务时调用。

### 商品来源 Port

```ts
export const RECOMMENDATION_PRODUCT_SOURCE = Symbol(
  'RECOMMENDATION_PRODUCT_SOURCE',
);

export interface RecommendationProductSource {
  readonly sourceId: string;
  readonly sourceType: 'local_catalog' | 'online_api' | 'mcp';
  search(
    input: RecommendationSourceSearchInput,
  ): Promise<RecommendationSourceSearchResult>;
}
```

本地 `product-catalog` 是首期唯一启用实现。在线 API/MCP 适配器只实现相同 Port，不得让编排器知道供应商名称、SDK 类型或原始响应字段。

## 推荐意图工具

### 工具职责

新增一个请求级 LangChain 工具，建议名称为 `search_fashion_recommendations`。它用于需要“商品 + 搭配”的请求；简单单品搜索仍可兼容既有 `search_local_clothing_products`，但两者不能在同一轮无界重复检索。

工具由 `ChatRecordsService.tools(prepared, display)` 创建，闭包绑定当前用户、会话和本轮 `RecommendationRequestScope`。模型不能传 `userId`、会话 ID、商品价格、库存、来源引用或游标密钥。

### 输入 Schema

建议位置：`apps/api/src/fashion-personalization/dto/recommendation-intent.dto.ts`。

```ts
const recommendationIntentSchema = z.strictObject({
  mode: z.enum(['item', 'outfit', 'both']).optional(),
  styles: z.array(z.string().trim().min(1).max(32)).max(3).optional(),
  occasion: z.string().trim().min(1).max(32).optional(),
  season: z.string().trim().min(1).max(32).optional(),
  category: z
    .enum(['tops', 'bottoms', 'dresses', 'outerwear', 'shoes'])
    .optional(),
  requestedSlots: z
    .array(z.enum(['tops', 'bottoms', 'dresses', 'outerwear', 'shoes']))
    .max(5)
    .optional(),
  size: z.string().trim().min(1).max(32).optional(),
  color: z.string().trim().min(1).max(32).optional(),
  fit: z.string().trim().min(1).max(32).optional(),
  budgetMin: z.number().finite().min(0).optional(),
  budgetMax: z.number().finite().min(0).optional(),
  inStock: z.boolean().optional(),
});
```

以上为技术草案，`mode` 默认值、预算币种、多尺码输入和每个槽位的独立预算仍需确认。对象使用 `z.strictObject`，数组去重、总长度和组合上限由 schema refine 与编排器双重保护；编排器只接受解析后的 `z.output`。

### 工具输出

工具返回受控 JSON：

```ts
type RecommendationToolOutput =
  | {
      ok: true;
      requestRef: string;
      targets: RecommendationTarget[];
      next?: null;
      incompleteSlots?: string[];
    }
  | {
      ok: false;
      code:
        | 'invalid_intent'
        | 'no_matching_product'
        | 'source_unavailable'
        | 'recommendation_unavailable';
    };
```

`requestRef` 是服务端生成的请求级引用，不是数据库 ID。商品事实来自统一来源投影，不能由模型自行添加。工具结果只进入本轮来源登记器和展示投影，不直接进入公开历史。

## 统一商品来源投影

建议位置：`fashion-personalization/context/recommendation-source.schema.ts`。

### 来源输入

`RecommendationSourceSearchInput` 至少包含：

- 当前推荐意图和一个槽位；
- 当前用户硬条件；
- 来源允许的页大小和超时预算；
- 服务端生成的请求引用。

不包含客户端或模型身份字段，不允许传入任意 SQL、URL、排序表达式或供应商参数。

### 来源输出

每个商品投影至少包含：

```ts
type RecommendationProduct = {
  sourceId: string;
  sourceType: 'local_catalog' | 'online_api' | 'mcp';
  sourceProductRef: string;
  sourceSkuRef: string | null;
  name: string;
  brand: string | null;
  category: 'tops' | 'bottoms' | 'dresses' | 'outerwear' | 'shoes';
  imageUrl: string | null;
  productUrl: string | null;
  price: string | null;
  currency: string | null;
  inStock: boolean | null;
  styles: string[];
  occasions: string[];
  colors: string[];
  fits: string[];
  observedAt: string;
  verifiedReasons: string[];
};
```

Zod schema 拒绝未知字段、危险 URL、超过长度的标签、非法金额和未来时间戳。`sourceProductRef` 和 `sourceSkuRef` 只用于服务端关联，不向模型暴露供应商私有载荷。

### 本地目录适配器

`LocalProductCatalogSource` 通过 `product-catalog` 的公开推荐 Port 获取：

- 有效商品和有效 SKU；
- 当前可售状态；
- CNY 价格；
- 图片和详情 URL；
- 已确认的类别、风格、场合、颜色、版型与匹配标签。

它不复制商品 Entity，也不改变现有 `product-catalog` 的库存、价格和游标规则。在线来源首期保持关闭；未来优先评估拼多多和淘宝适配器。未完成授权、接口和来源条款审查前，不能将其作为可用来源。在线来源不可用时，编排器可以仅返回本地结果并标记结果不完整，不能将模型知识填成商品。

## 推荐编排与穿搭组合

### 处理步骤

1. 解析并规范化意图，检查预算下限/上限和请求槽位。
2. 将意图拆成有界检索任务；单品模式最多一个类别，穿搭模式按槽位查询。
3. 并行查询启用的来源，但为每个来源设置超时、总候选数和失败隔离。
4. 合并来源结果，按稳定来源引用去重；没有稳定引用时不做跨来源合并。
5. 先执行预算、尺码、类别和有货等硬过滤，再计算软匹配分。
6. `OutfitComposerService` 根据方案模板组合商品，计算总价和缺失槽位。
7. 将排序后的目标写入请求级来源登记器，返回有限目标给模型和前端。

### 首期组合模板

- `dress_shoes_outerwear`：连衣裙 + 鞋，可选外套；
- `tops_bottoms_shoes_outerwear`：上衣 + 下装 + 鞋，可选外套；
- 单件或槽位无可验证结果时，返回已找到的商品并列出 `incompleteSlots`。

组合器使用确定性规则：

1. 当前需求硬条件；
2. 槽位完整性和来源可信度；
3. 风格/场合/颜色/版型标签重合；
4. 总价与预算匹配；
5. 稳定来源排序键。

不使用 LLM 生成商品属性，不用图片模型推断颜色或版型，不使用向量相似度。配饰、妆容、发型和动作只能在说明文本中出现，不能进入商品目标。

每轮推荐固定建议最多 2 套、每套 2–4 个商品项；槽位候选数、单品候选总数和来源超时仍属于实施前硬上限决策，技术实现必须有硬上限，即使模型重复调用也不能突破。

## 推荐组、卡片和消息持久化

### 请求级来源登记

沿用 `chat-card-display` 的请求级登记模式，扩展为推荐目标：

1. 推荐工具完成查询后，将规范化商品和整套方案登记到 `RecommendationRequestScope`。
2. `display_chat_card` 扩展一个受控的 `recommendation` 或 `outfit_recommendation` 模板，只接受本轮 `requestRef`、`outfitRef` 或商品引用。
3. 服务端从登记器重建卡片数据，不接受模型提交的价格、库存、来源或总价。
4. 卡片数据进入 `ChatDisplayService` 的统一 schema 和字节预算。
5. 服务器生成 `recommendationId`，在 `persistChat` 事务中将推荐组与最终 assistant message ID 绑定；如果消息事务回滚，推荐组不落库。

推荐组 ID 可以在请求创建时生成，SSE 卡片只在聊天完成后允许用户提交反馈；最终历史恢复使用同一 ID。未成功持久化的请求引用不会被反馈 API 接受。

### 推荐卡片数据

推荐卡片至少包含：

- `recommendationId`；
- `mode`、`styleSummary`；
- 单品或方案目标；
- 每个商品的名称、图片、价格/币种、库存布尔值、来源名称、观测时间和详情 URL；
- 可验证匹配理由；
- 缺失槽位和总价（不可计算时为 `null`）；
- 反馈目标引用。

现有 `product` 卡片保持兼容。整套方案卡片采用独立模板还是扩展现有 `product` 卡片仍需在实施前确定；无论采用哪种方式，都必须通过固定 registry 注册，不动态加载组件，不改变订单卡片权限。

## 持久化模型与任务

### Entity 与表

新增独立表，字段按 CRUD 契约落实：

1. `recommendation_groups`
   - `id`、`user_id`、`conversation_id`、`assistant_message_id`；
   - `intent_snapshot`、`targets`、`source_snapshot`；
   - `created_at`、`expires_at`。
   - 对用户、会话、assistant 消息建立索引；`assistant_message_id` 只能绑定一条推荐组。
2. `recommendation_feedback_events`
   - 反馈引用、目标类型/引用、反馈类型、原因码、受限短文本；
   - `request_snapshot`、`target_snapshot`、`created_at`；
   - 对用户、推荐组、目标和幂等键建立唯一/查询索引。
3. `recommendation_profiles`
   - `user_id` 主键；
   - 偏好风格、避开风格、场合、价格倾向、版型信号、证据数量、版本、更新时间；
   - `generation` 用于清空后的旧任务隔离。
4. `recommendation_settings`
   - `user_id` 主键、`enabled`、`updated_at`。
5. `recommendation_profile_tasks`
   - 用户、generation、状态、attempts、available_at、locked_at、锁 token、错误代码、最近事件水位；
   - 用于合并短时间内的多个反馈并支持租约/重试。

任务表和结果表不复用 `user-memory` 的 Entity；只复用其已验证的租约、generation、退避和优雅停机思路。是否需要单独的任务结果表取决于实施阶段选择“从事件重算”还是“候选操作幂等缓存”，暂列 T6。

### 画像更新

反馈 API 成功保存事件后，在同一事务内按用户和 generation 幂等登记 profile task。后台调度器：

1. 恢复超时 processing 任务；
2. 按租约领取有限批次；
3. 在事务外读取白名单反馈事件并计算候选画像；
4. 在用户级锁内重新检查设置和 generation；
5. 按版本条件更新 `recommendation_profiles`；
6. 标记任务成功或记录安全错误并退避重试。

关闭学习时不读取画像、不登记新的学习事件；清空画像时递增 generation 并使旧任务不能回写。画像更新失败不影响已经生成的商品回答或已保存的反馈事件。

首期不创建跨用户明细表。匿名聚合只保留 Port 和设计约束，待样本阈值、删除语义和退出机制确认后再增加表或任务。

## HTTP API、Schema 与错误映射

### Controller

建议位置：`apps/api/src/fashion-personalization/controller/fashion-recommendation.controller.ts`。

Controller 只读取 `@CurrentUser()`、接收已校验 DTO、调用 Service 并返回响应投影；不查询 Repository，不接收 `userId`。

### 请求 Schema

| 方法与路由                                   | Schema 位置                          | 规则                                                                                                                      |
| -------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/fashion-recommendation/feedback`  | `dto/recommendation-feedback.dto.ts` | `z.strictObject`；UUID 引用；`targetType` 与 `targetRef` 必须成对；反馈类型、原因码组合校验；短文本限制长度并拒绝控制字符 |
| `GET /api/fashion-recommendation/profile`    | 无 Body                              | 只使用认证上下文                                                                                                          |
| `DELETE /api/fashion-recommendation/profile` | 无 Body                              | 不接受客户端 userId；是否要求确认字段待 T7                                                                                |
| `GET /api/fashion-recommendation/settings`   | 无 Body                              | 只使用认证上下文                                                                                                          |
| `PATCH /api/fashion-recommendation/settings` | `dto/recommendation-settings.dto.ts` | 严格 `{ enabled: z.boolean() }`，拒绝未知字段                                                                             |

输入类型使用 `z.input<typeof schema>`，Controller 接收经过 `StandardSchemaValidationPipe` 的 `z.output<typeof schema>`。Swagger DTO 只负责 OpenAPI 元数据，不承担运行时校验。

### 响应和错误

- `POST feedback`：成功返回 `201`；相同幂等键重复提交返回约定的幂等响应，不重复增加证据。
- 越权、不属于当前会话或不存在的推荐组/目标统一 `404`，不暴露存在性。
- 未知字段、非法 UUID、非法原因码、过长短文本和失配目标返回 `400`。
- 未认证请求返回现有 JWT Guard 的 `401`。
- 画像读取失败返回 `503`，不能伪装成空画像。
- 任务写入失败不能回滚已生成的 assistant 回复；反馈保存与任务登记失败的事务策略需在实施阶段按数据库故障语义验证。
- 设置关闭、画像清空和任务 generation 冲突不返回内部锁或 SQL 信息。

## 前端技术方案

- 在 `apps/web/src/api/modules/fashion-recommendation.ts` 集中实现反馈、画像和设置 API；类型放在 `api/types/fashion-recommendation.ts`。
- 聊天卡片复用现有 `ChatCardTemplate` 注册机制，新增整套方案卡片和反馈控件；不解析工具 trace，不从 Markdown JSON 创建卡片。
- 反馈控件发送 `recommendationId`、assistant message ID、目标类型/引用和用户选择的原因码；服务端再次校验全部归属。
- 卡片使用固定图片比例、稳定槽位高度和响应式布局；来源、观测时间和价格信息不得被折叠到不可访问的 hover-only 状态。
- 反馈提交中、成功、重复、关闭学习和可恢复失败分别有明确 UI 状态；失败不清除当前推荐结果。
- 画像设置页面只展示汇总标签、证据数量、更新时间和开关，不展示原始短反馈、供应商原始响应或跨用户统计明细。

## 安全、可观测性与性能

- 商品事实、用户归属、会话归属和推荐组归属全部由服务端绑定；模型/客户端字段只作为候选输入。
- 推荐来源 URL 只接受绝对 HTTP/HTTPS；服务端不主动抓取商品链接，不因展示 URL 触发 SSRF。
- 在线来源的凭据仅在适配器服务端配置中读取，不进入模型、公开卡片、trace、activity 或日志。
- 原始供应商响应、完整聊天文本、图片 Base64、签名 URL、内部 UUID 以外的敏感实体字段不写入推荐快照。
- 日志只记录来源 ID、错误类别、候选数量、耗时、推荐组 ID 和任务 ID；不记录用户短反馈正文和价格明细集合。
- 每个来源、每个槽位和每轮推荐都有超时、候选数和总字节上限；来源失败隔离，不能拖垮聊天主流程。
- 画像排序只使用有限标签、证据数和版本；任何新信号必须先加入白名单和测试。

## 测试方案

### 后端

- Recommendation intent schema：合法输入、预算边界、数组去重、未知字段、非法槽位、默认/可选字段。
- Source projection：未知字段、危险 URL、非法金额、缺失价格/库存、来源超时和原始载荷不泄露。
- Orchestrator：硬条件优先、来源失败隔离、跨来源去重、稳定排序、空槽位和总价计算。
- Outfit composer：两种首期模板、预算超限、缺失槽位、重复商品、不可售 SKU 和结果上限。
- Request registry/card：跨轮引用、未登记引用、卡片预算、历史恢复、SSE 与最终消息一致性。
- Feedback HTTP：JWT、越权 404、未知字段 400、原因码组合、幂等重复、关闭学习和清空 generation。
- Profile task：租约恢复、并发领取、重试退避、设置关闭、generation 失效和版本更新。
- PostgreSQL：推荐组与 assistant 消息绑定、反馈唯一索引、用户隔离、事务回滚和删除行为。
- 真实模型不作为自动化测试依赖；使用 fake chat model 和 fake product source 完成工具往返。

### 前端

当前仓库没有已批准的组件/浏览器测试框架；实施阶段不临时新增测试依赖。至少执行：

- SSE/历史推荐卡片 schema 解析和未知模板降级；
- 反馈目标定位、提交状态、幂等响应和错误恢复；
- 商品图片缺失、来源/观测时间、价格币种和缺失槽位展示；
- 窄屏下整套卡片不横向溢出；
- 登录态聊天 smoke test，确认推荐卡片、反馈 API 和历史恢复使用同一推荐组引用。

## 验证命令

实施阶段按仓库约定执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm check
```

涉及 Migration 或 PostgreSQL 任务并发时，必须使用项目已有的可丢弃测试数据库门控；不得为普通验证未经确认运行 `migration:fresh`。浏览器和真实来源未执行时要单独报告，不能以类型检查代替。

## 技术决策记录

1. 已确认默认同时支持 `item` 和 `outfit`；每轮最多 2 套、每套 2–4 个商品项，候选数和来源预算按实施文档冻结。
2. 首期本地目录沿用 CNY；在线来源的多币种、汇率和跨来源总价不在首期启用。
3. 首期不启用在线 API/MCP；拼多多、淘宝为后续优先候选，平台接口、地区、授权和刷新策略在接入前另行确认。
4. 推荐卡片同时承载单品和整套方案；整套方案使用独立 `outfit_recommendation` 模板，SSE/历史 envelope 使用 `version: 1`。
5. 用户关闭学习后仍可提交反馈，服务端不落库并返回 `learning_disabled`，前端保留入口并明确提示。
6. 画像任务采用事件重算；10 秒合并窗口、30 秒租约、最多重试 3 次。
7. 清空画像要求严格 Body `{ confirm: true }`，删除未汇总反馈和派生画像，保留聊天正文与卡片并递增 generation。
8. 跨用户匿名聚合首期关闭；后续启用前重新确认最小样本阈值、删除延迟和退出开关。

## 技术阶段验收

- [x] 目录结构、公开 Port 和依赖方向已确认。
- [x] 推荐意图、来源投影、商品事实和穿搭组合规则已确认。
- [x] 推荐组与 assistant 消息的事务绑定、卡片协议扩展和历史兼容已确认。
- [x] Entity、任务租约、generation、幂等和删除语义已确认。
- [x] 每个 HTTP Body/Param/Query 的 Zod schema、未知字段策略和 400 映射已确认。
- [x] 在线来源首期关闭，拼多多/淘宝优先候选及后续授权边界已记录；跨用户聚合首期关闭。
