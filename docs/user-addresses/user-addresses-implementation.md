# 收货地址簿与 LLM 查询实施文档

## 状态与审批

- 状态：用户已于 2026-11-10 确认；实施已开始。
- 设计文档：[收货地址簿与 LLM 查询设计](./user-addresses-design.md)，已于 2026-11-10 确认。
- CRUD 契约：[收货地址 CRUD 契约](../contracts/user-address-crud-contract.md)，已于 2026-11-10 确认。
- 技术文档：[收货地址簿与 LLM 查询技术文档](./user-addresses-technical.md)，已于 2026-11-10 确认。
- 实现状态：核心实现与自动化验证已完成；2026-11-11 隔离 PostgreSQL Migration 测试通过；登录后浏览器 Smoke Test 尚未执行。
- 最后更新：2026-11-12（依据 2026-11-11 项目全量验证复测）。

## 实际完成记录

- 地址簿 API、Entity、严格 Zod schema、默认地址约束、幂等创建和增量 Migration 已实现。
- 本人订单摘要、本人地址引用、明确选择地址后写入当前购买草稿的模型工具已接入。工具不接收 `userId`；地址工具不向模型返回姓名、手机号或完整地址；工具 trace 采用专属字段白名单。
- 账号地址管理页和购买弹框地址选择/保存交互已接入。新地址只在用户点击后保存；未知结果重用原 `requestKey`；账号或会话切换会清理待处理保存状态。
- LLM 系统上下文与售后流程已更新，允许查询本人订单摘要和地址引用，同时明确禁止模型执行订单写操作或读取完整联系方式。
- 2026-11-10 验证：`pnpm --filter @clothes-shopping-guide/api typecheck`、`pnpm --filter @clothes-shopping-guide/api test`、`pnpm --filter @clothes-shopping-guide/web typecheck`、`pnpm --filter @clothes-shopping-guide/web build`、`pnpm format:check`、`pnpm check` 均通过。API 测试为 259 passed、15 skipped、0 failed；跳过项包含需专用 PostgreSQL 数据库的 Migration/集成套件。
- 2026-11-11 跨模块复测：全量验证记录确认 `RUN_USER_ADDRESSES_POSTGRES_TEST=1` 地址簿 Migration 在具名隔离库 `clothes_guide_user_addresses_test_full20261111_migration` 中 1 passed、0 failed。该结果引用自[项目全量验证计划](../testing/project-full-validation-plan.md)，不是本次重新执行。
- `git diff --check` 通过。没有运行 `migration:fresh`，也没有连接默认开发数据库。
- 待补验证：使用已认证开发账号执行地址页和购买弹框浏览器 Smoke Test。没有本次新的已登录浏览器证据，故不声称该流程已通过。

## 开发流程总览

目标是实现以下完整链路：

1. 用户在账号页管理本人收货地址。
2. LLM 以服务端绑定的当前账号查询本人订单摘要及地址引用。
3. 用户点击商品卡“购买”后，可在当前会话选用本人地址，或与助手补齐新地址。
4. 选择已有地址时，服务端校验归属、会话和草稿版本后，将地址快照写入购买草稿。
5. 新地址只在用户确认结构化地址卡并点击保存后进入地址簿；工具不具有地址簿写权限。
6. 所有工具 trace、activity 和日志遵守已批准的响应白名单，不新增明文地址副本。
7. 订单创建、支付、取消和确认收货继续只由既有用户显式操作触发。

实现中优先复用现有订单、购买草稿、JWT Guard、Zod/Nest Pipe、MikroORM、Vue API 底座和 shadcn-vue。无新增运行时依赖，不改变既有订单快照语义。

## 已更新的幂等与恢复规则

- 每次新增地址由客户端生成 UUID `requestKey`；服务端按 `(userId, requestKey)` 保证幂等。
- 同一用户、同一键、相同规范化字段重试返回原地址；同键不同字段返回 409。
- 地址簿保存与购买草稿更新分开提交，不做跨模块事务。保存成功后使用服务端返回的地址 DTO 继续更新草稿；若网络结果未知，使用原键重试。
- 该规则已同步到设计、CRUD 契约和技术文档；当前仅待用户确认本文实施方案，确认前不修改业务代码。

## 分工与文件所有权

本模块跨越后端资源、模型工具、追踪隐私和前端账号/购买交互。建议用户确认本文后，使用以下互斥所有权分工；代理只修改指派文件，公共接线由主代理负责。

### 子代理 A：地址簿 API 与持久化

负责：

- `apps/api/src/user-addresses/**`
- `apps/api/src/database/migrations/Migration<timestamp>_create_user_addresses.ts`
- `apps/api/src/database/spec/user-addresses-migration.postgres.spec.ts`

验收重点：CRUD/DTO、严格 Zod 校验、本人所有权、默认切换事务、唯一部分索引及具名隔离数据库迁移测试。不修改 `AppModule` 或聊天/LLM 文件。

### 子代理 B：订单/地址工具与追踪脱敏

负责：

- `apps/api/src/orders/tool/list-user-orders.tool.ts`
- `apps/api/src/chat-purchase/tool/select-shipping-address.tool.ts`
- `apps/api/src/chat-records/trace/chat-trace-writer.service.ts` 中工具白名单投影
- `apps/api/src/chat-records/spec/chat-trace-writer.service.spec.ts` 中新增回归用例
- `apps/api/src/orders/spec/order-query-tool.spec.ts`
- `apps/api/src/chat-purchase/spec/shipping-address-tool.spec.ts`

验收重点：工具 schema 不含 `userId`；本人隔离；订单每次最多 5 条；完整地址/手机号/姓名/custom label 不落 trace、activity、日志；工具不具备正式订单动作。不得修改 `ChatRecordsService`、Nest Module wiring 或购买草稿 Service。

### 子代理 C：账号地址管理页面

负责：

- `apps/web/src/api/modules/user-addresses.ts`
- `apps/web/src/api/types/user-addresses.ts`
- `apps/web/src/pages/account/addresses/**`

验收重点：页面 API 状态、取消/过期响应、防重复提交、CRUD 和默认切换控件、成功/失败 Toast、键盘和窄屏布局。不得修改 Router、共享导航、API types barrel 或聊天购买 Dialog。

### 主代理集成

主代理独占：

- `apps/api/src/app.module.ts`
- `apps/api/src/chat-records/chat-records.module.ts`
- `apps/api/src/chat-records/service/chat-records.service.ts`
- `apps/api/src/chat-purchase/chat-purchase.module.ts` 及需要的购买 Controller/Service 集成
- `apps/web/src/router/index.ts`
- `apps/web/src/pages/account/components/AccountNavigation.vue`
- `apps/web/src/api/types/index.ts`
- 购买 Dialog 的地址选择/地址保存交互文件及相应集成测试
- 根级配置、文档交付记录和最终差异整合

主代理确保 Provider 导出方向、所有权绑定、地址快照提交、请求幂等处理、工具逐请求创建、trace 与 SSE 安全投影及全链路测试一致。禁止两个所有者同时编辑同一路径；如出现需要跨界改动，先报告主代理重新划分。

以上分工是实施提案；本轮继续由主代理核对和集成现有改动。

## 子代理开始前检查

每位实施者开始前必须：

- 阅读仓库 `AGENTS.md`、本文、已确认设计/契约/技术文档及实际负责模块的现有代码。
- 确认工作树与目标文件当前内容；保留用户已有修改，不覆盖/清理被忽略的本地配置、上传文件或数据库。
- 复核 `apps/api/package.json`、`apps/web/package.json` 和迁移测试开关；不新增依赖。
- 执行前只在本地具名 disposable PostgreSQL 数据库运行 Migration/并发测试。
- 不读取、迁移或记录真实用户地址；所有测试采用合成地址数据，不调用真实模型服务或真实密钥。

## 按顺序排列的实施阶段

### 阶段 1：地址后端和迁移

- 完成 `UserAddress` Entity、Zod schemas、DTO、Service、Controller 和 Module。
- 实现用户归属过滤、默认地址事务及唯一约束映射。
- 添加请求幂等策略并覆盖同键同内容重试、同键异内容 409 和结果未知后的安全恢复。
- 建立独立 Migration 与隔离 PostgreSQL 迁移测试。
- 运行 API 类型检查、模块单测、HTTP 测试及地址 Postgres suite。

### 阶段 2：模型工具与隐私控制

- 增加本人订单摘要工具、本人地址引用工具和购买草稿地址选择工具。
- 在 `ChatRecordsService` 每次聊天中以认证用户和当前会话构造工具闭包。
- 对订单摘要/地址引用使用字段白名单；模型 schema 拒绝未知参数且不含 `userId`。
- 更新工具调用/结果数据库 trace 与 SSE activity 的专属安全投影。
- 验证用户原始消息的既有持久化边界；不要把“工具 trace 脱敏”表述为“聊天原文不持久化”。
- 使用 Fake Model 验证 `model -> tool_call -> tool_result -> model` 全链路；清理自己创建的测试记录。

### 阶段 3：账号地址页面

- 增加地址 API 适配器、类型、账号地址页、Dialog、列表和导航/Router 接线。
- 支持新增、编辑、删除、默认地址、空态、错误态、重试和防重复提交。
- 用 Toast 表达操作成功/失败；敏感地址数据只保留在当前页和当前购买过程。

### 阶段 4：购买对话地址流程

- 在购买 Dialog 中呈现本人地址引用；用户明确选中后由工具按 addressId 读取服务端记录并更新草稿。
- 新地址由已有草稿字段构建结构化确认卡。用户点击“保存地址”时通过地址簿 API 保存，并使用幂等键；“仅本次使用”不写入地址簿。
- 地址簿保存结果未知时使用同一幂等键重试，由服务端返回原地址结果，绝不盲目创建第二条记录。
- 账号/会话切换时清理临时选择和草稿投影，旧响应不得覆盖新状态。
- 订单确认仍展示现有完整收件信息并由用户显式确认；支付等动作不开放给模型。

### 阶段 5：主代理集成与完整验证

- 确认模块单向依赖、公开入口、Nest Provider token、Entity 自动发现和路由权限。
- 审阅 SQL Migration、索引、外键、默认唯一性、幂等键及回滚影响。
- 使用 Fake Model 做订单工具和地址选择端到端工具往返；确认 trace/SSE 均无完整 PII。
- 使用已认证开发账号完成地址页和购买弹框的手工 Smoke Test；避免真实地址和真实模型凭据。
- 按仓库命令完成格式、API/Web 类型检查、API 测试、构建和 `pnpm check`。
- 只在具名隔离测试数据库执行迁移；确认默认开发数据库未被清空或写入测试 fixture。
- 补充实际完成结果和缺口后更新交付记录。未运行的浏览器/全链路验证明确列为未完成。

## 子代理完成报告

每个代理必须按此格式向主代理交付：

```text
修改文件
执行命令
测试结果
未解决风险
越界修改
```

主代理逐项核验文件所有权与测试命令；不能将被跳过的环境门控测试汇报为通过，不能将源代码检查等同于真实模型 Smoke Test。

## 验收标准

- 地址管理 CRUD 与已确认契约一致，认证/禁用/越权行为正确。
- 默认地址并发写满足部分唯一约束；请求重试不会重复创建。
- 订单工具仅返回当前用户安全摘要，地址工具仅返回引用，二者均没有 `userId` 输入。
- 选择地址通过服务端所有权与当前草稿版本校验；新地址写入必须由用户显式点击并可安全重试。
- 订单快照与地址簿独立；更改/删除地址不改变历史订单。
- 模型工具不具备正式订单动作；商品购买、订单确认和支付继续遵守已审批流程。
- PII 不出现在新工具 trace、tool activity、摘要、长期记忆或应用日志。
- API/Web 代码遵循项目模块、Vue、Zod、Toast 与组件约定。
- Migration、权限、schema 边界、Fake Model 工具往返及所列检查均有可复现的验证结果。

## 风险与停止条件

- 若实际实现无法满足同键同内容重试、同键异内容 409 或地址簿/购买草稿分开提交的恢复规则：停止编码，先修改并重新确认相关契约/技术文档。
- 工具返回或 trace/SSE 出现姓名、手机号、完整地址或用户自定义标签：停止交付并修复后回归测试。
- 默认地址并发测试无法证明唯一性：不得依赖应用层先查后写；必须依靠事务和数据库约束。
- 迁移目标不是专用 disposable 数据库、数据库名未通过安全前缀校验、或无法确认测试数据归属：停止 Migration 测试。
- 上游价格/订单流程、已有购买字段或聊天历史发生不兼容变化：回到相关已确认契约重新审批，不在本模块中扩大订单范围。
- 真实用户照片、地址、电话或真实外部模型凭据出现在测试上下文：立即停止该测试路径并清除仅由本次创建的测试输出，保留用户已有环境数据。
