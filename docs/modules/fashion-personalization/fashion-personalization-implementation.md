# 个性化商品与穿搭推荐实施文档

## 状态与依据

- 状态：已确认，实施中。
- 设计文档：[个性化商品与穿搭推荐设计文档](./fashion-personalization-design.md)。
- 技术文档：[个性化商品与穿搭推荐技术文档](./fashion-personalization-technical.md)。
- CRUD 契约：[个性化商品与穿搭推荐 CRUD 契约](../../contracts/fashion-recommendation-crud-contract.md)。
- 最后更新：2026-11-22。

设计文档、CRUD 契约、技术文档和本文已获用户确认；以下决策按用户“设计文档中带确认的问题都按你推荐的来做”冻结，允许进入代码实施。

## 实施范围

本次实施只覆盖已确认的首期闭环：

- 在服务端解析推荐意图，复用本地 `product-catalog` 查询真实商品。
- 按硬条件过滤、确定性排序并组合连衣裙/鞋/外套或上衣/下装/鞋/外套方案。
- 通过请求级来源登记器生成受控单品和整套推荐卡片。
- 在 assistant 消息事务中绑定推荐组，支持 SSE、同步响应和历史恢复。
- 提供本人反馈、派生推荐画像、学习设置和清空能力。
- 用显式反馈更新个人画像；画像只作为软排序信号，不写入结构化偏好或 Markdown 长期记忆。

明确不在本次实施范围：

- 不接入尚未选定的平台、在线 API 或 MCP 商品源；首期优先实现本地目录，拼多多和淘宝仅作为后续优先候选，适配器只保留 Port 和禁用实现边界。
- 不创建跨用户明细或匿名聚合排序数据；相关接口和隐私规则另行审批。
- 不新增向量数据库、推荐系统 SaaS、网页抓取器、队列产品或隐式行为学习。
- 不改变商品主数据、SKU、订单、支付、库存和既有购买授权。
- 不把模型生成的价格、库存、链接、品牌、颜色或版型当作商品事实。

## 实施前决策门（已冻结）

以下决策已按设计文档建议冻结：

1. 同时支持 `item` 和 `outfit`；每轮最多 2 套、每套 2–4 个商品项；单品最多 6 个，单个槽位最多 4 个候选；单个来源查询超时 1500ms，总推荐查询预算 4000ms。
2. 首期本地目录沿用 CNY；多币种、汇率和跨来源总价不进入首期。
3. 在线 API/MCP 首期保持关闭；拼多多、淘宝仅保留独立 Port/适配器边界，接入、授权、地区、预算、限流、链接和刷新策略另行审批。
4. 整套方案采用独立 `outfit_recommendation` 卡片模板；SSE、同步响应和历史恢复统一使用 `version: 1` 的安全 envelope，旧消息缺失该模板时安全忽略。
5. 关闭学习后仍允许用户提交反馈，但服务端不落库，返回 `{ accepted: false, reason: "learning_disabled" }`；前端保留入口并明确提示。
6. 画像任务采用反馈事件重算，不增加候选结果表；同一用户 10 秒合并窗口，租约 30 秒，最多重试 3 次，任务 generation 用于清空保护。
7. 清空画像要求严格 Body `{ confirm: true }`；删除该用户未汇总的反馈事件和派生画像，保留聊天正文与推荐卡片，递增 generation 使在途任务失效。
8. 反馈事件和用户短反馈最多保留 180 天；清空时立即删除该用户未汇总反馈和派生画像，过期清理不删除聊天正文或展示快照。
9. 首期不采集、不存储、不使用跨用户匿名聚合数据；后续启用前重新确认最小样本量、删除延迟、退出开关和发布阶段。

## 开发流程总览

```text
冻结实施前决策
  -> 主代理冻结公共接口和测试替身
  -> 领域与商品来源
  -> 持久化、反馈 API 与画像任务
  -> 聊天卡片、消息事务与历史兼容
  -> Web 卡片、反馈和设置页面
  -> 主代理接线、迁移审阅和回归验证
  -> 数据库门控验证与登录态 Smoke Test
```

每一阶段完成后先审阅文件边界和测试证据，再进入下一阶段。共享数据库、迁移目录和开发端口不得由多个代理并行操作。

## 子代理角色和文件所有权

若本实施文档获确认并按团队方式实施，采用以下独占所有权。公共模块注册、根配置、跨模块接口和最终集成由主代理维护。

| 负责人                     | 独占修改文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 职责与边界                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 代理 A：推荐领域与商品来源 | `apps/api/src/fashion-personalization/context/`、`apps/api/src/fashion-personalization/port/`、`apps/api/src/fashion-personalization/source/`、`apps/api/src/fashion-personalization/service/recommendation-orchestrator.service.ts`、`apps/api/src/fashion-personalization/service/outfit-composer.service.ts`、`apps/api/src/fashion-personalization/service/recommendation-source-registry.service.ts`、`apps/api/src/fashion-personalization/spec/recommendation-*.spec.ts`、`apps/api/src/product-catalog/service/product-catalog-recommendation.port.ts`、`apps/api/src/product-catalog/service/product-catalog-recommendation.service.ts`、对应 `product-catalog` 导出和单测 | 实现统一商品投影、硬条件过滤、确定性排序、穿搭组合和本地目录公开 Port。不得读取其他模块私有 Repository，不得修改聊天持久化、Entity、Migration 或 Web。           |
| 代理 B：反馈资源与画像任务 | `apps/api/src/fashion-personalization/entity/`、`apps/api/src/fashion-personalization/dto/`、`apps/api/src/fashion-personalization/controller/`、`apps/api/src/fashion-personalization/service/recommendation-group.service.ts`、`recommendation-feedback.service.ts`、`recommendation-profile.service.ts`、`recommendation-settings.service.ts`、`apps/api/src/fashion-personalization/task/`、对应 `spec/`、新增 `apps/api/src/database/migrations/Migration*.ts`                                                                                                                                                                                                                 | 实现推荐组、反馈、画像、设置、generation/租约、HTTP Schema 和错误映射。不得自行修改 `ChatRecordsService`、商品来源适配器或前端；Migration 只新增本模块表和索引。 |
| 代理 C：聊天卡片与 Web     | `apps/api/src/chat-records/display/chat-display.types.ts`、`chat-display.projection.ts`、`apps/web/src/api/modules/fashion-recommendation.ts`、`apps/web/src/api/types/fashion-recommendation.ts`、`apps/web/src/api/modules/chat.ts`、`apps/web/src/api/types/chat.ts`、`apps/web/src/pages/chat/components/` 中推荐卡片/反馈组件与模板 plumbing、`apps/web/src/pages/account/recommendation-settings/`                                                                                                                                                                                                                                                                            | 接入推荐卡片的 SSE/同步/历史安全投影、反馈控件和设置页面。不得编辑推荐 Entity、画像任务、ChatRecordsService、路由或账户导航；共享聊天服务接线由主代理完成。      |
| 主代理：公共接线与最终集成 | `apps/api/src/fashion-personalization/fashion-personalization.module.ts`、`index.ts`、`apps/api/src/app.module.ts`、`apps/api/src/chat-records/service/chat-records.service.ts`、`apps/api/src/chat-records/chat-records.module.ts`、`apps/api/src/chat-records/history/`、`apps/api/src/chat-records/trace/`、共享卡片类型/schema、Web 路由与账户导航、根文档索引                                                                                                                                                                                                                                                                                                                  | 冻结跨模块 Port，接入请求级 Scope，保证推荐组和 assistant 消息同事务绑定，维护 trace/历史边界，处理冲突并执行最终验证。                                          |

新增测试文件必须在开工前登记归属。任何代理若发现必须跨越上述文件边界，先停止并向主代理报告，不自行扩权。

## 子代理开始前检查

1. 重新执行 `git status --short --branch`，保留当前文档修改和用户其他未提交改动。
2. 记录基线分支、提交和工作区差异；不执行 `git reset --hard`、`git checkout --`、`git clean` 或覆盖式生成。
3. 阅读根 `AGENTS.md`、`docs/development/agent-guide.md`、相关设计/技术/契约，以及 `product-catalog`、`chat-records`、`user-preferences`、`user-memory` 当前源码。
4. 核对现有 Zod 4、`StandardSchemaValidationPipe`、MikroORM 迁移、任务租约和卡片来源登记模式，不新增重复基础设施。
5. 先冻结推荐意图、来源投影、推荐目标、反馈 DTO、卡片 envelope 和公开 Port；代理只在冻结接口后开工。推荐组内部端口使用 `persistInTransaction` 和 `lookupOwnedTarget`；目标以 `targetType`、服务端 `targetRef` 和白名单安全快照扁平登记。
6. 确认未选定的在线来源保持关闭，并确认现有系统上下文中“本地真实商品查询”与新工具行为一致。

## 按顺序排列的实施阶段

### 阶段 0：决策与接口冻结

- 主代理记录实施前决策门的最终答复。
- 明确 `RecommendationRequestScope` 的生命周期、推荐组 ID 生成时机和事务回调。
- 固定商品目录 Port 的公开投影，不把 `Product`/`ProductSku` Entity 暴露给推荐模块。
- 固定卡片 schema、目标引用、反馈幂等键和任务 generation 语义。

### 阶段 1：领域与商品来源

- 代理 A 实现推荐意图 schema、来源白名单、统一商品投影、编排器和两个首期穿搭模板。
- 为硬条件、来源失败、空槽位、预算超限、稳定排序和结果上限增加单元测试。
- 主代理审阅商品事实是否全部来自目录公开 Port，禁止模型或图片推断补字段。

### 阶段 2：持久化、反馈 API 与画像任务

- 代理 B 实现五类资源的 Entity、Migration、Repository/Service、反馈/设置 DTO 和本人权限边界。
- 实现推荐组归属校验、反馈幂等、任务租约、generation 清空保护和版本更新。
- 增加 HTTP 400/401/404/503、未知字段、越权引用、重复反馈和并发任务测试。

### 阶段 3：聊天接入与持久化绑定

- 主代理接入请求级推荐 Scope 和 LangChain 工具，限制单轮调用次数、来源和字节预算。
- 代理 C 扩展 `chat-records/display` 的推荐卡片 schema、来源登记和历史恢复。
- 主代理在 `persistChat` 同一事务中绑定推荐组与 assistant message；回滚时不得留下可反馈的推荐组。
- trace 只记录安全投影，公开历史只读取 `publicDisplay`；旧卡片 envelope 缺少推荐字段时安全回退。

### 阶段 4：Web 交互

- 代理 C 接入推荐卡片、整套槽位、价格/币种、来源/观测时间、缺失槽位和反馈状态。
- 增加账户推荐学习设置页，复用现有 `/account` 布局与认证 API 底座。
- 确保窄屏、键盘、图片缺失、错误重试和历史消息恢复不改变推荐事实。

### 阶段 5：主代理集成与迁移审阅

- 注册 `FashionPersonalizationModule`，接入 `AppModule`、聊天模块、商品目录 Port、偏好/记忆 Reader Port。
- 审阅 Migration 的新表、唯一约束、索引、外键和账号删除/清空语义；不改既有商品、订单、聊天和记忆数据。
- 检查所有相对导入保留 `.js`，新增代码中的复杂业务规则使用中文注释。

### 阶段 6：验证与交付

- 先运行定向 schema/service/spec，再运行格式、类型、构建和 API 测试。
- 在独立可销毁 PostgreSQL 数据库上运行迁移、事务回滚、用户隔离、任务并发和清空测试。
- 可用环境中执行登录态聊天 Smoke Test：推荐工具、单品/整套卡片、反馈提交、设置关闭、历史恢复。
- 未连接真实模型、未启用在线来源或未完成浏览器验证的项目，单独标记为未执行，不以构建通过替代。

## 主代理集成任务

主代理必须完成以下审阅：

- 推荐模块只依赖商品目录公开 Port、偏好/记忆 Reader Port 和聊天公开能力，不导入其他模块私有 Entity/Repository。
- 推荐组、assistant 消息和 `publicDisplay` 使用同一事务与同一推荐引用；生成失败或事务回滚后反馈 API 返回安全的 `404`。
- 反馈请求的用户、会话、消息、目标、商品快照和幂等键全部服务端校验；模型不能写入反馈或画像。
- 画像更新失败不影响已经持久化的聊天回答和反馈事件；关闭学习及清空 generation 能阻止旧任务回写。
- 商品价格、库存、来源、URL 和观测时间只来自来源投影；历史卡片不声称当前实时事实。
- 在线 API/MCP 适配器、跨用户匿名聚合和隐式行为不在本次交付中被误接入。

## 子代理完成报告

每个代理完成后必须报告：

```text
修改文件
执行命令
通过、失败、跳过及未执行项
未解决风险
越界修改
```

主代理逐文件审阅 diff；代理未报告的文件、未执行的测试和被跳过的断言不能算作完成。

## 验收标准

- 用户只能对属于本人会话、assistant 消息和推荐组的目标提交反馈。
- Body、Query、路由参数全部绑定所属模块的严格 Zod schema；未知字段返回 `400`。
- 推荐结果满足硬条件优先、确定性排序、来源白名单和有限结果预算。
- 单品卡、整套卡、SSE、同步响应和历史恢复使用一致的服务端投影。
- 推荐组和 assistant 消息事务绑定；事务回滚不留下可反馈引用。
- 重复反馈幂等；画像只使用允许的显式反馈，且只作为软排序信号。
- 关闭学习不产生新的画像学习数据；清空后在途任务不能回写。
- 结构化用户偏好和 Markdown 长期记忆不被推荐画像任务自动修改。
- 迁移、任务租约、并发更新、删除/清空和账户隔离均有专用测试。
- 未执行的真实模型、在线商品源、浏览器和窄屏检查单独记录。

## 风险和停止条件

- 如果实施前决策门没有明确答复，停止对应功能，不用代码默认值掩盖产品选择。
- 如果需要改变商品、订单、聊天、偏好或记忆的既有契约，回到设计/CRUD/技术阶段重新审批。
- 如果推荐卡片无法仅凭本轮服务端登记结果重建，停止接线，不能信任模型传入的任意 `data`。
- 如果在线来源需要凭据、网页抓取或平台条款但未完成授权审查，保持适配器关闭。
- 如果画像任务会读取完整聊天原文、写入结构化偏好或 Markdown 记忆，停止并重新审查隐私边界。
- 如果迁移、事务或任务测试只能操作默认开发数据库，停止数据库验证并改用项目门控的隔离数据库。
- 如果代理越界修改共享文件、未报告真实验证结果或覆盖用户已有修改，主代理保留工作区并先解决边界问题。

## 当前阶段

实施文档已获用户确认并已完成代码实施。主代理已完成模块注册、聊天工具与事务接线、迁移审阅和 Web 交互集成。

## 实际交付与验证记录

### 已交付

- 本地 `product-catalog` 推荐来源、硬条件过滤、确定性排序、单品与整套卡片。
- 推荐组与 assistant 消息同事务绑定，支持同步响应、SSE 和历史安全恢复。
- 本人反馈、推荐画像、学习设置和清空接口；重复反馈幂等，关闭学习不落库。
- Web 聊天反馈控件和账户推荐学习设置页。
- 推荐资源迁移 `Migration20261122120000`；未改动既有商品、订单、支付、库存和记忆数据。

### 已执行

- API typecheck：通过。
- Web typecheck：通过。
- `pnpm format:check`：通过。
- API 全量测试：446 项，428 通过、18 跳过、0 失败。

### 未执行或仍需专项环境

- API build、Web build 和根 `pnpm check`：已通过。
- 独立可销毁 PostgreSQL 的迁移、事务、用户隔离、任务并发和清空验证：未执行；当前没有为推荐模块新增专用 PostgreSQL 门控测试。
- 登录态浏览器 Smoke Test：未执行。
- 真实模型调用、拼多多/淘宝在线来源和 MCP：未接入，未执行。

上述未执行项不以类型检查、构建或局部单测替代端到端结论。
