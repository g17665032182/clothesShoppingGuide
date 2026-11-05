# 商品目录实施文档

## 状态与依据

- 状态：商品目录原实施范围已确认并完成；“查看更多商品”直接分页增量计划待用户确认。
- 设计：[服装导购体系设计文档](./product-guide-design.md)，已确认。
- 契约：[商品目录 CRUD 契约](../contracts/product-catalog-crud-contract.md)，已确认。
- 技术：[商品目录技术文档](./product-catalog-technical.md)，已确认。
- 最后更新：2026-11-05。

原商品目录实施范围已经完成。本次直接分页增量计划经用户确认后才允许进入代码实施；本文件本身不代表新增功能已经实现。

## 开发流程总览

```text
本地依赖与官方文档复核
  -> 后端目录、迁移、查询和导入实现
  -> LLM/聊天工具接入及持久化投影
  -> 前端聊天卡片和续页交互
  -> 单元/HTTP/PostgreSQL/链路测试
  -> 集成检查、Smoke Test 与交付记录
```

## 固定规则

- 字段长度、类别、adult 受众、SKU 尺码字符串和 CNY `numeric(12,2)` 按契约实施。
- JSON v1 最大 10 MiB、最多 5,000 个商品、每商品最多 100 个 SKU；全文件严格校验后单事务写入。
- 首轮查询继续通过受保护聊天入口调用服务端工具；“查看更多”使用已确认的商品目录只读下一页 API，复用全局 JWT Guard。
- 软匹配命中各加 1 分，按约定外部 ID 稳定排序；每页固定 3 件，点击查看更多时继续取下一页。
- 签名游标有效期 15 分钟；`PRODUCT_QUERY_CURSOR_SECRET` 必填且不得提供默认密钥。
- 商品卡片按消息时快照保存，历史记录不得暗示实时价格或库存。
- 下一页沿用首轮 query 全部筛选条件及 limit；只有经商品查询 schema 校验的 query 可以进入聊天展示快照。
- 不新增商品/SKU Entity、字段、Migration、Seeder 或运行时依赖；追加的下一页结果只更新当前前端会话状态，不写回历史聊天快照。

实现中如遇到会改变已确认字段、权限、排序、导入或用户可见行为的未决情况，停止对应阶段并回到设计/契约审批，不得自行假设。

## 本次增量实施计划（待用户确认）

### 范围

- 点击“查看更多”直接请求 `POST /api/product-catalog/next-page`，不调用 `sendMessage`、聊天 SSE 或 LLM。
- 保持原结果组及原消息归属；同一结果组独立加载、失败可重试，游标失效时提示重新搜索。
- 新历史快照只保存由 `productSearchSchema.omit({ cursor: true })` 校验的首轮 query；不公开其他工具参数。旧快照没有 query 时隐藏分页按钮。
- 不把下一页响应写回服务端历史快照。无 Entity、Migration、导入、默认 Seeder、LLM Tool Registry 或新依赖改动。

### 阶段 F：商品目录直接分页 API 与验证

所有权：主代理，范围较小且 API、公开投影和聊天 Store 有紧密状态契约，不拆分并行文件所有权。

- 新增 `apps/api/src/product-catalog/controller/product-catalog.controller.ts`。
- 新增 `apps/api/src/product-catalog/dto/product-next-page.dto.ts` 和响应 Swagger DTO。
- 修改 `apps/api/src/product-catalog/product-catalog.module.ts` 与 `service/product-catalog.service.ts`，Controller 调用既有 `search` 查询能力并完整沿用签名游标校验。
- 修改 `apps/api/src/chat-records/display/chat-display.types.ts`、`chat-display.service.ts`、`chat-display.projection.ts`，按 tool call ID 白名单解析商品 query，并兼容缺少 query 的历史展示数据。
- 在 `apps/api/src/product-catalog/spec/` 与 `apps/api/src/chat-records/spec/` 补 schema、HTTP 和公开投影测试。

### 阶段 G：聊天前端分页交互

所有权：主代理；组件只负责声明式交互，API 通过资源模块公开。

- 新增 `apps/web/src/api/modules/product-catalog.ts` 与 `apps/web/src/api/types/product-catalog.ts`。
- 修改 `apps/web/src/api/types/chat.ts`、`apps/web/src/stores/chat/index.ts` 和必要的 `stores/chat/` 页面状态，按 session/message/result-set 定位结果并执行直接请求。
- 修改 `apps/web/src/pages/chat/page.ts`、`index.vue`、`components/ChatMessageList.vue`、`ChatAssistantMessage.vue`、`ChatProductResults.vue`，传递结果组身份、展示 loading/error/retry 状态并原位追加商品。
- 保持组件 Props/Emits 单向数据流；商品结果组件不得直接请求 API，聊天 Store 负责异步状态、重复提交保护及过期响应保护。

### 集成顺序和验收

1. 先实现后端 strict schema、Controller 和 Service 接线；验证合法请求、未知字段、非法/篡改/过期游标、limit/查询条件不匹配及未认证边界。
2. 再接入聊天展示 query 白名单和旧快照兼容；确认其他工具的 input 仍不进入公开展示数据。
3. 最后实现资源 API 模块、Store 请求状态和结果组追加；确认单击不新增 user message、不触发聊天 SSE/LLM，且切换会话或结果组时不会串写。
4. 成功响应按 `externalId` 去重、追加 items 并更新 cursor；网络错误可重试；HTTP 400 提示重新搜索而不自动调用 LLM。
5. 只执行增量验证，不执行数据库 Migration 或 `migration:fresh`。API 执行 typecheck、test、build；修改文件格式检查和 `pnpm check`。前端不新增尚未批准的测试框架，使用现有可运行检查并做浏览器 smoke test。

本阶段确认后才开始修改业务代码；若实现发现游标无法在不改变已确认筛选条件的情况下继续分页，暂停并回到技术/契约审批。

## 工作阶段与文件所有权

每一阶段完成后先由主代理审查再进入下一阶段。若使用子代理，任务按下表隔离文件，根级接线、共享契约、锁文件和最终集成由主代理维护；不得让多个执行者同时修改同一个文件。

### 阶段 A：商品目录领域和数据库

所有权：商品目录后端实现者。

- `apps/api/src/product-catalog/**`
- `apps/api/src/database/migrations/Migration<timestamp>.ts`
- 商品目录专属测试 `apps/api/src/product-catalog/spec/**`

交付：

- Product/SKU Entity、映射和唯一约束。
- 查询应用服务、严格输入 schema、确定排序和匹配理由。
- 迁移 SQL 审查及 PostgreSQL 验证。
- 模块公开入口只暴露 DTO、查询端口或工具工厂，不导出 Repository/Entity 供外部模块使用。

### 阶段 B：版本化 JSON 导入

所有权：商品目录导入实现者；与阶段 A 分属不同文件时可串行后并行集成，领域 schema 由阶段 A 所有者维护。

- `apps/api/src/product-catalog/import/**`
- `apps/api/src/scripts/import-product-catalog.ts`
- `apps/api/fixtures/product-catalog/**`
- 对应导入测试文件。

交付：

- Zod strict schema 和版本校验。
- 整文件预校验、dry-run、幂等事务写入、错误定位和退出码。
- fixture 显式加载，不接入生产默认 Seeder 或启动流程。
- 事务失败回滚和导入重复执行测试。

### 阶段 C：LLM 工具与聊天展示数据

所有权：聊天/LLM 接入实现者。

- `apps/api/src/llm/tools/**` 中必要的注册接口调整。
- `apps/api/src/chat-records/**` 中工具上下文和公开投影的必要适配。
- `apps/api/src/product-catalog/tool/**` 中商品工具实现。
- 相关 LLM、聊天与商品工具集成测试。

交付：

- 通过 Nest composition root 注入产品工具，不构造循环模块依赖。
- 工具从可信认证上下文获得用户身份，只返回白名单 DTO。
- Fake Chat Model 覆盖工具调用、工具结果、assistant 回答和 `publicDisplay` 持久化。
- 历史恢复重新校验商品投影、链接和消息归属。

### 阶段 D：前端商品卡片与聊天交互

所有权：聊天前端实现者。

- `apps/web/src/pages/chat/**` 中页面私有组件、页面状态和展示类型。
- `apps/web/src/api/modules/chat.ts` 及对应 `src/api/types/` 中必要适配。

交付：

- 类型化商品结果投影、卡片、图片失败状态、详情外链和空结果展示。
- “更多/换一批”沿既有聊天 API/查询句柄提交，不在卡片组件直接请求 Axios。
- 加载、重复提交防护、错误和过期响应保护。
- 桌面/移动视口无横向滚动，布局尺寸稳定。

### 阶段 E：主代理集成与验收

所有权：主代理。

- `apps/api/src/app.module.ts`、模块组合入口和共享接线。
- 根级依赖、配置、脚本、锁文件和最终文档状态。
- 需要调整的现有契约、系统上下文、聊天设计/技术文档。

交付：

- 检查所有依赖方向、导入路径、权限和公开投影。
- 复核迁移 SQL、fixture 不会自动进入生产、错误信息不泄露内部数据。
- 汇总真实执行的验证和未覆盖风险。

## 子代理开始前检查

若按并行分工执行，每个实现者开始前必须：

- 阅读本实施文档以及已确认的设计、CRUD 契约和技术文档。
- 复核当前分支和 `git status`，保护已有工作。
- 核对本机已安装包及锁定版本，并阅读 MikroORM、NestJS、Zod、LangGraph 对应官方文档。
- 只修改被分配的文件；发现契约缺口时暂停相关实现并报告，不自行扩大需求。
- 为新增业务代码添加必要中文注释，解释业务边界、事务或复杂状态，不做逐行注释。

## 验收标准

### 数据与导入

- Migration 可在空数据库和当前可保留数据的数据库中安全执行；只增加商品相关结构，不触碰用户、聊天、偏好数据。
- 外部商品/SKU 唯一约束正确。
- 非法 JSON、未知字段、重复 ID 和任何事务失败都不会造成部分写入。
- 相同输入重复导入结果稳定；文件中缺席的商品按已批准策略处理。
- 生产启动和普通生产 seed 不会导入开发 fixture。

### 查询与聊天

- 只返回有效商品及有效 SKU；硬筛选完全满足后才参与结果。
- 排序确定，匹配理由是服务端可验证的有限标签。
- 无结果时不放宽预算、尺码或库存要求。
- 分页/换批与用户、会话和原始查询绑定，不重复商品且拒绝篡改游标。
- 商品工具不能通过参数伪造当前用户，不能返回 Entity、SQL 错误或未公开字段。
- 聊天响应和历史记录只含经 allowlist 校验的商品卡片数据。

### 前端

- 卡片不展示工具 trace 或未经校验的模型编造字段。
- 图片、详情 URL 缺失或加载失败均有稳定降级行为。
- 分页过程中防止重复提交；失败可恢复，不破坏现有聊天记录。
- 桌面和移动视口布局正确，无横向滚动或文字重叠。

### 工程验证

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
```

此外执行 PostgreSQL Migration/事务导入测试、真实 HTTP 认证验证；可控的 Fake Model 端到端工具链测试；以及前端浏览器 Smoke Test。不得使用真实第三方密钥或不可控外部网络。未经明确授权不得运行会清空数据库的 `migration:fresh`。

## 风险和停止条件

- 价格/币种或 SKU 尺码数据尚未定稿：停止模型/迁移实现，先更新契约。
- 无法在不循环依赖的情况下将产品工具装入通用 Graph：停止接线，重新评审公开工具注册端口。
- 历史聊天公开投影无法可靠绑定 assistant 消息：不得通过正文猜测恢复卡片，需回到聊天契约审查。
- 游标无法绑定原始查询和当前用户：不开放跨请求“更多/换一批”。
- 迁移要求改写历史业务数据或普通验证要清空本地库：停止并向用户说明影响。
- PostgreSQL、浏览器或认证环境不可用：报告阻塞，不得声称相应验收已通过。

## 实施完成报告

### 本次实施记录

- 完成 Product/SKU 表结构与 Migration、严格 JSON v1 导入 CLI、商品查询工具、签名游标、聊天 SSE/历史商品投影及聊天页商品卡片和续页交互。
- 复用现有 MikroORM、NestJS、Zod、LangGraph 和聊天消息流，无新增运行时依赖；新增必填配置 `PRODUCT_QUERY_CURSOR_SECRET`，应用启动时校验至少 32 字符。
- 商品导入和卡片 URL 拒绝私网、保留地址及凭证 URL；商品结果通过严格白名单 schema 写入聊天展示快照。
- `pnpm check` 通过；API 全量测试 139 通过、0 失败、6 个 PostgreSQL 专项测试跳过；商品目录 dry-run 输出 `{"valid":true,"products":1,"skus":1}`。
- 对配置的本地 `clothes_guide` 执行了增量 `migration:up`，商品表 Migration 成功；迁移器同时执行了此前待执行的既有 `Migration20261105100000`（记忆任务 `source_turns` 字段），两条均已在迁移记录中确认。未执行 `migration:fresh`，未导入 fixture。
- 本地 PostgreSQL 只读查询 smoke test 覆盖多条件筛选与有效签名游标，SQL 执行成功且目录为空。真实分页数据与事务导入验证仍待专用测试库；浏览器级 Smoke Test 未执行。
- 启动 API 前需在部署环境设置高熵 `PRODUCT_QUERY_CURSOR_SECRET`；需要演示商品时再显式运行 fixture 导入命令。
