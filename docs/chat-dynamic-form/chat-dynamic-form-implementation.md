# 聊天动态表单实施文档

## 状态与依据

- 状态：已实施，待隔离数据库与浏览器 Smoke Test。
- 前置审批：设计文档与 CRUD 契约已确认；技术文档已确认。
- 实施范围：按已确认的 Formily + 服务端白名单方案实现首个 `purchase_recipient` 接入。
- 最后更新：2026-11-13。
- 关联文档：[设计文档](./chat-dynamic-form-design.md)、[技术文档](./chat-dynamic-form-technical.md)、[CRUD 契约](../contracts/chat-dynamic-form-crud-contract.md)、[购买契约](../contracts/chat-purchase-crud-contract.md)、[流式聊天契约](../contracts/chat-streaming-crud-contract.md)。

本文按已确认的实施范围执行；未通过隔离数据库和浏览器验证的项目不标记为全链路通过。

## 交付范围

### 交付

- `request_dynamic_form` 模型工具。
- 服务端动态表单注册表、实例持久化、生命周期、归属检查、revision 和幂等提交。
- `purchase_recipient` 购买草稿处理器，只更新本人当前会话的活跃购买草稿。
- `form` SSE 事件、历史安全引用和 `form-result` 提交结果。
- 读取、提交、取消动态表单的认证 HTTP API。
- Vue 3 + Formily 动态表单卡片。
- Formily 静态字段组件注册表，映射已有 shadcn-vue 控件。
- 字段错误、过期、冲突、断网、重复提交、账号/会话切换处理。
- API、schema、隐私、并发、迁移和前端类型/构建验证。

### 不交付

- 任意低代码编辑器或任意 API 代理。
- 模型生成 Vue/HTML/JavaScript/CSS 或动态加载组件。
- 文件上传、富文本、嵌套数组、条件表达式、自定义正则。
- 通过表单确认直接创建订单、支付、取消订单或确认收货。
- 跨多个业务处理器的组合表单。
- 提交值跨刷新恢复或写入 Pinia/localStorage。
- 未经额外确认的其他表单类型。

## 实施前检查

主代理开始前必须：

1. 重新检查 `git status`、README、AGENTS、设计/技术/契约文档和当前聊天/购买源码，保留所有已有修改。
2. 核实 Formily 当前版本的 `@formily/core`、`@formily/vue` peer dependency、Vue 3/Vite/TypeScript 兼容性，以及 shadcn-vue 控件的受控值和事件接口。
3. 读取当前 API `StandardSchemaValidationPipe`、`DbExceptionFilter`、聊天展示投影、购买草稿公开边界和 MikroORM migration 约定。
4. 固定动态表单 Entity、响应类型、handler Port、SSE envelope、前端 API 类型和字段注册表接口；接口变化必须先回到技术文档。
5. 确认可销毁 PostgreSQL 隔离库名称和 `RUN_*` 门控；不对默认数据库运行 `migration:fresh`、迁移或集成测试。
6. 记录 API/Web 类型检查、构建和 API 测试基线；没有获准的 Vitest、Vue Test Utils 或 Playwright 时不安装替代测试框架。

## 子代理角色和文件所有权

实施批准后使用最多三个子代理角色，主代理负责公共接线、依赖和最终集成。共享工作区下每个文件只有一个写入负责人。

### 代理 A：动态表单领域与 HTTP

**独占文件：**

- `apps/api/src/chat-dynamic-form/**`
- `apps/api/src/chat-dynamic-form/spec/**`

**任务：**

- 创建 Entity、DTO/Zod schema、响应投影、处理器 Port、注册表和应用服务。
- 实现读取、提交、取消、过期、归属、行锁、revision 和幂等规则。
- 实现 `purchase_recipient` handler 所需的公开购买 Port 接口调用；不得引用购买 Entity、Repository 或私有实现。
- 创建模块 Controller、Swagger 文档和模块级测试。
- 提交值不得写入 Entity、trace、日志或异常文本。

**禁止：**

- 修改 `chat-records`、`llm`、Web、根配置、Migration、lockfile。
- 创建正式订单或调用购买确认/支付/取消能力。

### 代理 B：聊天工具、SSE 和历史展示

**独占文件：**

- `apps/api/src/llm/tools/**` 中动态表单工具相关新文件
- `apps/api/src/llm/spec/**` 中与工具注册相关的新增/调整测试
- `apps/api/src/chat-records/display/**` 中动态表单展示类型、投影和服务测试
- `apps/api/src/chat-records/history/**` 中动态表单历史投影相关测试或 mapper 调整
- `apps/api/src/chat-records/trace/**` 中动态表单安全投影相关测试或调整

**任务：**

- 实现 `request_dynamic_form` 工具的严格模型输入和服务端安全定义调用。
- 将动态表单事件接入内部流事件、聊天展示投影、trace/activity 脱敏和历史恢复。
- 保持 `done` 语义、现有卡片/购买/试穿事件和展示预算兼容。
- 保证模型原始参数和用户填写值不进入公开 activity、trace、历史或日志。

**接线边界：**

- 不修改 `ChatRecordsService`、`ChatRecordsModule`、SSE Controller 或根模块；需要公共接线时向主代理提交明确接口和测试要求。
- 不直接访问动态表单 Entity/Repository。

### 代理 C：Web Formily 卡片与 API 适配

**独占文件：**

- `apps/web/src/api/modules/chat-dynamic-form.ts`
- `apps/web/src/api/types/chat-dynamic-form.ts`
- `apps/web/src/pages/chat/components/dynamic-form/**`
- `apps/web/src/pages/chat/components/ChatAssistantMessage.vue` 中动态表单插槽/事件接线所需最小修改
- `apps/web/src/api/modules/chat.ts`、`apps/web/src/api/types/chat.ts`、`apps/web/src/stores/chat/turn.ts` 中动态表单协议所需最小修改

**任务：**

- 增加严格 `form`/`form-result` SSE 类型解析和 HTTP API adapter。
- 使用 Formily `createForm` 与 `@formily/vue` SchemaField；把服务端字段转换成受限本地 schema。
- 使用静态 `type -> component` 注册表连接已有 shadcn-vue 输入、文本域、电话、数字、选择和复选框控件。
- 实现提交中、防重复、字段错误、冲突/过期核实和状态展示。
- 未提交值只存在组件生命周期内，不进入 Pinia 持久化、聊天 history 或 localStorage。

**禁止：**

- 不接受或执行服务端传来的 `x-component`、effects、scope、表达式、脚本、URL。
- 不修改全局基础 UI、路由、认证底座或其他业务页面。
- 不自行新增前端测试框架；Formily 依赖由主代理统一确认、安装和锁定。

### 主代理独占文件和职责

- `apps/api/src/chat-records/service/chat-records.service.ts`
- `apps/api/src/chat-records/controller/llm-chat.controller.ts`
- `apps/api/src/chat-records/chat-records.module.ts`
- `apps/api/src/llm/tools/tool-registry.ts`
- `apps/api/src/chat-purchase/**` 中公开 Purchase Port、模块导出和相关测试
- `apps/api/src/database/migrations/**`、数据库快照和迁移测试
- `apps/api/src/app.module.ts`、根/包 `package.json`、`pnpm-lock.yaml`
- Web 跨模块公共接线、`ChatMessage` 组装、必要的页面父级事件接线
- 所有契约、README、验证记录和最终差异审查

主代理负责审阅子代理报告、解决依赖冲突、维护模块注册和跨模块事务边界，不通过批量格式化或回滚覆盖其他修改。

## 子代理开始前统一要求

每个代理必须阅读：

- 根 `AGENTS.md` 和相关 `docs/development/*`。
- 动态表单设计、技术、CRUD 契约和本文。
- 自己负责模块的现有源码、测试和公开入口。
- Formily 官方 Vue 文档及当前锁定版本的 package 文档（代理 C）。

每个代理必须遵守：

- 使用 pnpm 和原生 ESM `.js` 相对导入。
- 新增复杂业务逻辑使用简短中文注释说明业务边界。
- 不读取或打印真实密码、Token、手机号、详细地址或完整环境文件。
- 不操作默认开发数据库，不修改未分配文件。

## 按顺序排列的实施阶段

### 阶段 0：主代理冻结接口和依赖

1. 主代理记录工作区基线和测试基线。
2. 固定 `ChatDynamicForm` 安全 DTO、handler Port、公开购买 Port、SSE envelope、前端 API 类型和 Formily 本地 schema 转换规则。
3. 主代理确认并安装 Formily 依赖，核对 peer dependency；若兼容性不满足，暂停并回到技术文档重新确认。
4. 明确 `formId + conversationId + userId` 归属、revision、TTL、幂等结果和错误映射。

退出条件：所有输入/输出、事务所有权、隐私字段和文件所有权一致，无循环依赖。

### 阶段 1：并行实现叶子模块

1. 代理 A 完成动态表单领域、HTTP 和单元测试。
2. 代理 B 完成工具、展示/trace/historical 投影边界和测试。
3. 代理 C 完成 Formily 控件注册、字段转换、API adapter、卡片局部状态和类型解析。

退出条件：各代理报告修改文件、命令、通过/失败/跳过/未执行、风险和越界修改；局部测试通过，未修改公共接线。

### 阶段 2：主代理后端接线与迁移

1. 接入 `ChatDynamicFormModule`、动态表单工具注册和聊天编排调用。
2. 接入 `form` SSE、保存 assistant 消息后的 `assistantMessageId` 绑定和历史安全引用。
3. 在购买模块新增公开 Port/Token，handler 只调用草稿 patch 能力。
4. 创建 `chat_dynamic_forms` 增量 migration，审查索引、状态约束、删除方向和回滚。
5. 以具名隔离 PostgreSQL 验证 migration up、旧数据读取、rollback 和再次 up。

退出条件：聊天保存、表单实例、购买草稿和历史展示的依赖方向清晰；提交值没有任何结构化持久化副本。

### 阶段 3：主代理前端集成

1. 将动态表单关联到 assistant message，不改变已有 Markdown、商品卡、购买卡和试穿卡行为。
2. 接入 Formily 卡片显示、提交回执、错误/冲突/过期处理和会话切换清理。
3. 使用当前 shadcn-vue 控件完成键盘和窄屏布局代码审查。
4. 账号切换、刷新和断流时丢弃未提交内存值，禁止旧响应覆盖新会话。

退出条件：Web typecheck/build 通过；没有把 Formily schema 的任意执行能力暴露给服务端 JSON。

### 阶段 4：自动化验证与 Smoke Test

1. 运行 schema、service、handler、HTTP、聊天流和隐私单测。
2. 运行 API typecheck、API build、Web typecheck、Web build、`pnpm check` 和格式检查。
3. 使用隔离数据库运行动态表单 migration/HTTP/并发测试；验证重复提交最多调用一次购买 Port。
4. 启动本地 API/Web，执行带认证的聊天表单 SSE、读取、提交、冲突、刷新恢复和取消 Smoke Test。
5. 如无获准浏览器测试基础设施，明确记录浏览器视觉/键盘验收未执行，不把构建结果写成浏览器通过。
6. 更新本文实施状态、实际命令、通过/失败/跳过/未执行项和剩余风险。

## 验收标准

- [ ] 未确认实施文档前没有 Entity、Migration、业务代码或依赖改动。
- [ ] Formily 只管理受限本地 schema，未知字段类型、组件名、表达式和脚本均被拒绝。
- [ ] `request_dynamic_form` 只能生成注册 `formKind` 和字段，不能提供用户/会话/提交目标。
- [ ] `form` SSE 只发送服务端验证后的定义；用户填写值不进入模型、trace、activity、历史或日志。
- [ ] 表单 HTTP API 严格校验 Body/Param、归属、revision、TTL 和状态。
- [ ] 同一表单并发或重复提交最多调用一次业务 handler。
- [ ] `purchase_recipient` 只更新本人活跃购买草稿，不创建订单、支付或取消动作。
- [ ] 购买 handler 通过公开 Port，不依赖购买 Entity/Repository 私有实现。
- [ ] Formily 卡片覆盖 `text`、`textarea`、`tel`、`number`、`select`、`checkbox`，并支持字段级错误。
- [ ] 页面刷新恢复安全定义和状态，但不恢复未提交值。
- [ ] 旧聊天历史、旧 SSE 事件和已有购买/卡片展示保持兼容。
- [ ] migration 可升级、回滚、再次升级，且不使用默认数据库。
- [ ] API/Web 类型检查和构建结果、测试数量及未执行项均有真实记录。

## 风险和停止条件

- Formily peer dependency、Vue 3/Vite 构建或 shadcn-vue 受控控件适配失败：停止安装/实现，回到技术文档重新确认，不静默换成另一套表单库。
- 若动态表单提交值进入日志、trace、activity、聊天历史或模型上下文：停止发布，先补齐脱敏边界和回归测试。
- 若购买 Port 无法在现有草稿版本约束下保证重复提交不覆盖并发修改：停止购买 handler，实现前回到技术阶段。
- 若需要跨表单和购买模块共享事务、增加订单动作或扩大字段白名单：回到设计/CRUD 契约重新确认。
- 若 migration 需要修改既有业务数据且无法证明兼容：暂停迁移并报告，不运行 `migration:fresh` 代替验证。
- 若代理修改越界文件或未报告测试状态：主代理暂停集成，先审阅差异和恢复边界。
- 若数据库、模型、认证浏览器或 Formily 依赖不可用：只报告已验证范围，不声称全链路通过。

## 实际交付记录（2026-11-13）

- 已实现：动态表单 Entity、严格 Zod schema、注册表、购买草稿处理器、读取/提交/取消 API、`request_dynamic_form` 工具、`form` SSE、历史安全引用、Formily 卡片和提交状态管理。
- 已验证：API/Web typecheck、API/Web build、API 全量单测（301 项，286 通过、15 跳过）、动态表单 schema 定向测试（4 项通过）、Prettier 检查、`git diff --check`。
- 未执行：隔离 PostgreSQL migration up/down/up、动态表单 HTTP 并发 Smoke Test、认证浏览器/移动端视觉与键盘验收。
- 已知边界：动态表单状态与购买草稿写入仍由两个服务事务分别提交；跨事务故障由草稿版本冲突和客户端重新读取核实，不能宣称原子提交。

## 子代理完成报告格式

```text
修改文件：
公开接口或接线要求：
执行命令：
测试结果（通过/失败/跳过/未执行）：
隐私与安全检查：
未解决风险：
越界修改（没有则写无）：
```

## 主代理交付记录要求

实施完成后必须记录：

- 实际修改文件、依赖版本和 migration 名称。
- 每个子代理的报告摘要及主代理集成处理。
- API/Web 格式、类型、构建、测试和隔离数据库命令及结果。
- SSE、HTTP、重复提交、过期、冲突、账号/会话切换 Smoke Test 证据。
- Formily 浏览器交互是否实际验证；未执行项单独列出。
- 敏感值未进入 trace、activity、历史、日志和长期记忆的证据。
- 剩余风险、未部署状态和不应运行 `migration:fresh` 的环境提醒。
