# 对话本人订单履约摘要实施文档

## 状态和授权

- 状态：代码已完成；API 类型检查、构建和静态差异审阅通过，业务测试及运行验收暂缓。
- 日期：2026-11-17。
- 依据：[设计](./chat-tool-order-fulfillment-design.md)、[技术](./chat-tool-order-fulfillment-technical.md)、[契约](../../contracts/chat-tool-order-fulfillment-crud-contract.md)。
- 用户已要求直接完成文档后实施，并继续下一阶段；沿用既有 agent team 分工要求。本阶段不重新打开已确认的订单写权限和隐私边界。
- 用户“先不做测试”继续有效：不新增或执行测试，静态检查单独报告。

范围限定为精确订单号、本地状态和时间；不开放承运商、物流单号或实时轨迹，不新增业务 API、数据结构、依赖或 Web 行为。

## 分工和文件所有权

### A：订单只读能力与工具

独占：

- 新增 `apps/api/src/orders/dto/order-fulfillment-lookup.dto.ts`
- 新增 `apps/api/src/orders/service/order-fulfillment-reader.service.ts`
- `apps/api/src/orders/orders.module.ts`
- `apps/api/src/orders/index.ts`
- 新增 `apps/api/src/chat-records/tools/chat-order-fulfillment.tool.ts`

交付严格 schema、独立只读精确查询、公开注入和绑定身份的工具。禁止修改现有订单 Service/Entity/Controller、聊天编排、history/trace、文档、Web 和测试。

### B：历史与追踪隐私

独占：

- `apps/api/src/chat-records/history/chat-history.mapper.ts`
- `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`

交付调用/结果配对隐藏及固定 trace 白名单，覆盖独立、嵌套、非法和孤立路径。禁止修改其他文件和测试。

### 主代理：编排、提示词与集成

独占其余文件，主要为：

- `apps/api/src/chat-records/service/chat-records.service.ts`
- `apps/api/src/llm/context/system-context.md`
- `apps/api/src/llm/context/after-sales-flow.md`
- 本阶段四份文档、能力清单、契约索引和 README。

负责 JSON/SSE 共用注册、reader 注入、现有来源隔离标记接线、提示词限制、审阅代理代码及最终静态检查。不修改测试装配以掩盖生产依赖问题。

## 启动要求与接口

- 各代理先阅读本阶段文档、AGENTS、后端和安全约定，检查当前文件；保留已有修改。
- reader 名称 `OrderFulfillmentReaderService`，方法 `getForChat(userId, input)`，工厂 `createChatOrderFulfillmentTool(reader, userId, onRequested)`。
- 工具名 `get_my_order_fulfillment`；输入与结果以契约为准；任何扩展先由主代理协调，不交叠写入。
- 不安装包、不运行测试/数据库/构建、不启动外部服务，不提交或推送。
- 必要新增注释使用中文。交付报告包括修改文件、命令、静态结果、未解决风险、越界修改。

## 实施顺序

1. [x] 核对 Git、现有字段、依赖、契约和实际源码，完成四份文档。
2. [x] A/B 按互斥文件并行开发，主代理处理共用编排和文档。
3. [x] 主代理核对字段、只读查询、注册、trace/history 和来源标记的一致性。
4. [x] 定向 Prettier、API typecheck/build 和差异检查。
5. [x] 留存实际结果及暂缓验证清单，同步索引与能力清单。

## 静态审阅标准

- 输入只有必填订单号，身份始终服务端绑定。
- 领域查询不选择或映射任何 recipient/shipment 字段，不调用订单写服务。
- 成功仅有状态/时间与固定来源；无结果不与故障混淆。
- 解析通过后第一个 await 前标记来源；JSON/SSE 使用同一工具。
- trace 参数无订单号，结果无订单号/时间；activity 明细为空，历史隐藏调用与结果。
- 订单写流程、原查询工具、Web、Entity、迁移、依赖和配置不变。
- 提示词不将发货登记解释为实时物流/签收，不代用户收货。

## 待授权的业务验证

以下全部暂缓，不记为通过：

| 验证             | 重点                                                |
| ---------------- | --------------------------------------------------- |
| schema 与工具    | 缺失、空值、控制字符、未知键、身份参数和异常结果    |
| 领域与数据库     | 本人/他人/不存在、五状态、日期、只读事务和无写入    |
| JSON/SSE HTTP    | 实际 ToolNode 调用与结果反馈、认证、无新增事件      |
| trace/history    | 独立/嵌套/非法/孤立消息，不含订单号、时间或隐私字段 |
| 记忆与摘要       | 成功/未找到/失败整轮排除、无任务、下一普通轮恢复    |
| 真实模型与浏览器 | 本地来源说明、订单歧义、故障重试及原订单页面        |

## 风险与停止条件

发现需要开放 shipment、接入承运商、改变权限/订单状态或新增迁移时，暂停对应扩展，先更新设计和契约确认。无法证明安全投影覆盖持久化路径时，先修复而非依赖提示词。

本轮不操作数据库，不启动模型/物流供应商，不执行业务验收；类型检查和构建不能证明上述待验证项。

## 实际交付记录

2026-11-17 完成如下工作：

- A 完成订单 schema、公开 reader、模块导出及工具工厂；B 完成 history 和 trace；主代理完成共用工具注册、来源标记、运行提示词、文档同步和集成审阅。两代理均未越界修改，未运行测试、构建或数据库。
- 新工具已接入 JSON/SSE 共用工具装配。完整应用通过既有 `OrdersModule` 注入 reader；精简装配无 reader 时不注册工具，不提供假成功或占位查询。
- 静态复核确认 SQL 仅选择四项订单字段，精确绑定 userId/orderNo，使用独立只读事务；结果严格二次投影。history 隐藏新工具及对应结果；trace 独立、嵌套、非法调用的参数不保留订单号，结果不保留订单号或时间。
- 复用已有 `detailQueryRequested` 每轮标志和原消息保存事务；未更改来源服务、记忆任务或摘要算法。下一轮准备时标志重置为 false。此为源码审阅结论，实际持久化链路未验证。
- API 类型检查与构建通过；17 个变更文件定向格式检查及 `git diff --check` 通过。没有 Web、共享类型、依赖或根配置改动，未运行 Web 构建或全仓 `pnpm check`。
- 未新增或运行测试。自动化、数据库、真实模型和浏览器验收全部暂缓，不计为通过。未连接数据库、启动服务或调用物流/模型供应商；没有新增进程或数据库清理事项。
- 变更保留为未提交状态，未推送或部署。

实际检查命令：

```bash
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api build
git diff --check
```

定向格式检查使用 `pnpm exec prettier --check`，覆盖 README、契约索引、本阶段四份文档、能力清单、订单模块五个文件、聊天编排/history/trace 和两个运行上下文文件，共 17 个文件；完整清单可从本节分工及 Git 差异核对。
