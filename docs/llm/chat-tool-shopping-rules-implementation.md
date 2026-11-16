# 对话本站购物规则查询实施文档

## 状态与范围

- 日期：2026-11-17。
- 状态：代码集成完成；API 类型检查、构建、定向格式及差异检查通过，业务测试和运行验收暂缓。
- 用户授权：沿用直接写完文档后实施、agent team 及本轮“继续”“确认”；测试继续暂缓。
- 依据：[设计](./chat-tool-shopping-rules-design.md)、[技术](./chat-tool-shopping-rules-technical.md)、[契约](../contracts/chat-tool-shopping-rules-crud-contract.md)。

只发布既有系统事实的五主题静态目录，不创建真实商家政策、售后办理或物流来源，不改权限、订单行为、数据库或 Web。

## 文件所有权

### A：规则目录与工具

独占三个新增文件：

- `apps/api/src/chat-records/dto/shopping-rules.dto.ts`
- `apps/api/src/chat-records/knowledge/shopping-rules.catalog.ts`
- `apps/api/src/chat-records/tools/chat-shopping-rules.tool.ts`

负责严格 schema、固定可追溯目录、纯读取和 `createChatShoppingRulesTool(onRequested)`，不得改现有编排、history/trace、文档、业务服务或测试。

### B：历史与 trace

独占：

- `apps/api/src/chat-records/history/chat-history.mapper.ts`
- `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`

负责新工具调用/结果配对隐藏、嵌套/非法/孤立路径和 trace 白名单。保留上一阶段履约工具等已有未提交改动，不改其他文件或测试。

### 主代理：接线和交付

独占其余改动：

- `apps/api/src/chat-records/service/chat-records.service.ts`
- `apps/api/src/llm/context/system-context.md`
- `apps/api/src/llm/context/after-sales-flow.md`
- README、本阶段四份文档、契约索引和能力清单。

负责共用注册、本轮隔离标记、运行提示词、审阅代理交付及最终检查。不新增 Nest provider 或修改旧订单服务来支持静态目录。

## 开始与交付要求

各代理先读四份文档、AGENTS、后端/安全约定、所有权内现有实现及本地库声明。不得安装包、提交/推送、连接数据库、启动服务、调用外部供应商或运行测试/构建。必要注释使用中文，保留已有未提交修改。

交付报告包含：修改文件、命令、静态结果、风险、越界修改。若需要改他人文件先交主代理协调，不能并发写同一文件。

## 实施顺序

1. [x] 核对能力、已确认来源及当前源码，完成四份文档。
2. [x] A/B 互斥实施；主代理同步编排、提示词和索引。
3. [x] 主代理审阅来源正文、schema、历史/trace、来源隔离及兼容性。
4. [x] 定向格式、API 类型和构建、差异检查。
5. [x] 更新实际结果，单列暂缓项。

## 审阅和后续验收

静态审阅确认：

- 五主题仅包含已确认系统事实；来源和版本固定，不编造政策、退款状态、联系方式或物流时效。
- 输入只有 topic；输出严格、只含请求主题、数组有界；异常固定失败。
- JSON/SSE 共用注册；规则调用本轮退出记忆和摘要来源，下一轮恢复。
- trace/history 各编码不保存正文或原始非法参数；activity 明细为 null。
- 无依赖、环境变量、API、Web、数据库或订单动作变化。

待后续授权的业务验证：schema/目录、故障路径、实际 ToolNode JSON/SSE、历史/trace 持久化、记忆/摘要隔离及真实模型回答。当前不新增或运行这些测试，不将源码审阅或构建计作业务验收。

## 停止条件

发现说明与当前源码或已确认契约矛盾时先删除/修正，不引用旧设计补齐。真实政策、法律资格、实时物流、售后处理或对外承诺超出范围，必须重新明确来源和权限后再接入。

## 实际交付记录

2026-11-17：

- A 新增 DTO/schema、五主题只读目录和工具工厂；B 完成历史隐藏和独立 trace 投影；主代理接入 JSON/SSE 共用数组、来源资格回调、运行上下文及文档。代理均按所有权交付，无越界修改；未运行测试、类型检查或构建，由主代理统一检查。
- 实际运行正文来自 `shopping-rules.catalog.ts`，有固定来源和版本，读取返回副本。主代理逐项核对当前订单源码中的零运费、模拟支付、30 分钟支付期、待付款取消及整单发货规则；未将历史过时设计作为来源。
- 新工具没有 Nest provider、个人数据读取、数据库或外部请求。JSON/SSE 使用同一注册入口；同步回调沿用 `detailQueryRequested`，原消息事务、来源服务与摘要逻辑没有改动。此为静态审阅结论，不代表实际工具往返或持久化链路通过。
- 源码审阅确认 trace 对独立、嵌套、非法及原生 function 编码使用白名单；结果仅主题、固定版本、计数或固定错误，历史隐藏调用及结果；activity 通用路径 input/output 仍为 null。
- 通过：`pnpm --filter @clothes-shopping-guide/api typecheck`、`pnpm --filter @clothes-shopping-guide/api build`、15 个本阶段文件定向 Prettier 检查及 `git diff --check`。没有 Web 或共享包改动，未运行 Web 构建或全仓 `pnpm check`。
- 未新增或运行测试。数据库、实际 HTTP/ToolNode、trace/history 持久化、记忆/摘要链路、真实模型和浏览器验收均未执行，不计为通过。没有新服务、进程或数据库资源需要清理。
- 保留上阶段全部未提交变更；本阶段也未提交、推送或部署。未修改 Entity、迁移、锁文件、环境配置、业务写接口或测试。

定向格式检查文件：

```text
README.md
docs/contracts/README.md
docs/contracts/chat-tool-shopping-rules-crud-contract.md
docs/llm/chat-tool-capability-inventory.md
docs/llm/chat-tool-shopping-rules-design.md
docs/llm/chat-tool-shopping-rules-technical.md
docs/llm/chat-tool-shopping-rules-implementation.md
apps/api/src/chat-records/dto/shopping-rules.dto.ts
apps/api/src/chat-records/knowledge/shopping-rules.catalog.ts
apps/api/src/chat-records/tools/chat-shopping-rules.tool.ts
apps/api/src/chat-records/service/chat-records.service.ts
apps/api/src/chat-records/history/chat-history.mapper.ts
apps/api/src/chat-records/trace/chat-trace-writer.service.ts
apps/api/src/llm/context/system-context.md
apps/api/src/llm/context/after-sales-flow.md
```

各代理仅执行所属文件的定向格式/差异检查。主代理最终命令：

```bash
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api build
# 将上列 15 个文件作为显式参数。
pnpm exec prettier --check <上列文件>
git diff --check
```

真实店铺政策、商家维护后台、退款进度和实时物流仍需另行提供经确认的来源与权限，当前未实施。
