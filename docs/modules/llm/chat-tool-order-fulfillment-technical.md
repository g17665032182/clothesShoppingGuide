# 对话本人订单履约摘要技术文档

## 范围与复用

- 状态：依据用户直接完成文档并实施的授权完成代码集成；静态检查通过，业务测试和运行验收暂缓。
- 日期：2026-11-17。
- 依据：[设计](./chat-tool-order-fulfillment-design.md)、[契约](../../contracts/chat-tool-order-fulfillment-crud-contract.md)。

复用已安装 `@langchain/core`、Zod 4、MikroORM 7.2.5、Nest 注入及当前聊天工具编排。不新增依赖。参考现有 `ProductSkuReaderService` 的独立只读事务、`createChatPreferencesTool` 的身份绑定和边界投影。

官方工具 schema 和 MikroORM 事务文档参考入口：

```text
https://reference.langchain.com/javascript/langchain/tools
https://mikro-orm.io/docs/transactions
https://mikro-orm.io/api/core/interface/TransactionOptions
```

本轮已读取本地安装包 README、Connection/EntityManager 声明及相邻实现，核对事务的 `readOnly`、隔离级别和 fork 上下文选项。实际 API 以本地安装版本为准。

## 文件和公开接口

订单模块新增：

- `dto/order-fulfillment-lookup.dto.ts`：严格输入、结果 schema 和派生类型。
- `service/order-fulfillment-reader.service.ts`：`OrderFulfillmentReaderService.getForChat(userId, input)`。
- 通过 `orders/index.ts` 和 `OrdersModule` 公开 schema、类型与 reader。

聊天模块新增 `tools/chat-order-fulfillment.tool.ts`，公开工厂：

```typescript
createChatOrderFulfillmentTool(reader, userId, onRequested);
```

主编排注入 reader，并在 JSON/SSE 共用的工具数组注册；`onRequested` 在第一个 await 前设置现有明细查询来源隔离标记，不另建持久化字段。沿用当前 Service 的可选领域能力装配方式：完整应用已通过 `OrdersModule` 导出 reader；精简装配未提供 reader 时不注册工具，也不创建假查询实现。

## Schema 与错误边界

- 输入为 `z.strictObject({ orderNo })`；字符串 trim、1–100 字符、无控制字符，无默认和类型转换。分别导出 `z.input`、`z.output` 类型，供工具和领域边界复用。
- 成功结果为严格对象，`ok: true`、固定来源、固定 false 及严格嵌套订单对象；状态仅现有五值，时间仅 ISO 字符串或 null。
- 失败为严格 `{ ok: false, code: "not_found" | "unavailable" }`。
- 工具将领域返回再次显式投影、按结果 schema 校验、再 JSON 序列化；禁止对象展开原始结果。
- 非法工具参数交由已有工具 schema 校验拒绝。没有 HTTP 新增 Body/Query/Param，也无需新 Nest Pipe 或 Swagger DTO。
- 读取异常和输出校验异常都返回固定 unavailable，不输出异常或日志原文。

## 领域读取

1. 解析输入。
2. 使用订单 Repository 的 EntityManager 独立 fork，清空 identity map、不继承外部事务或请求上下文。
3. 开启短只读 REPEATABLE READ 事务，绑定事务上下文。
4. 只选择 `order_no`、`status`、`shipped_at`、`completed_at`，条件为绑定 userId 和精确 orderNo。SQL 参数绑定，不拼接参数值。
5. 无记录统一 not_found；合法记录显式映射，日期转换为 ISO；异常值失败关闭为 unavailable。

不访问 recipient、shipment、明细、库存、过期处理、下载或外部供应商。事务不调用 flush，不复用带写入语义的完整详情/动作服务。

## 历史、追踪与记忆

- 将工具加入隐藏历史名单，复用现有独立、嵌套、非法及孤立工具消息清理。
- trace 将其纳入安全工具名单，输入投影固定 `{}`。
- 成功输出只投影 `ok`、固定来源、固定实时标志、合法状态；失败只投影固定错误。不能通过通用 serializer 保留订单号或时间。
- activity 沿用安全工具 `input/output: null`。
- 复用现有明细查询每轮标志；任何经校验执行均使两条消息在原保存事务中不可提取、无提取入队，来源/摘要保护继续生效。下一轮不继承标记。
- 更新服务端实际加载的 `system-context.md`、`after-sales-flow.md`，明确精确订单查询和本地记录限制。

## 验证边界

用户要求先不做测试：本阶段不写 spec、不执行单测、集成、数据库验证、真实模型或浏览器测试。主代理运行定向格式检查、API 类型检查与构建、`git diff --check`，并静态审阅 Web 无改动及原工具兼容性。

待另行授权的验收矩阵记录于实施文档；静态结果不能证明数据库只读事务、工具实际往返、认证或记忆持久化链路通过。
