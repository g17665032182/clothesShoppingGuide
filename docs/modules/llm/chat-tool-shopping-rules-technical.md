# 对话本站购物规则查询技术文档

## 状态与复用

- 日期：2026-11-17。
- 状态：文档后直接实施已完成；API 类型检查、构建和定向格式检查通过，业务测试和运行验收暂缓。
- 依据：[设计](./chat-tool-shopping-rules-design.md)、[契约](../../contracts/chat-tool-shopping-rules-crud-contract.md)。

复用本地安装的 `@langchain/core/tools`、Zod 4 与现有聊天编排，不添加框架、搜索库或向量存储。已读取相邻工具、API 包清单；通过 Context7 核对 LangChain 官方 `tool` 配合 Zod schema、字符串结果的用法：

```text
https://docs.langchain.com/oss/javascript/langchain/context-engineering
```

本地声明和现有 `createChatOrderFulfillmentTool` 为具体版本实现依据。

## 文件和接口

- `chat-records/dto/shopping-rules.dto.ts`：topic schema、固定版本、固定 notice、输入/结果 schema 和派生类型。
- `chat-records/knowledge/shopping-rules.catalog.ts`：五类只读目录及 `readShoppingRules(topic)`，无 Nest 注入或数据库依赖。
- `chat-records/tools/chat-shopping-rules.tool.ts`：工厂 `createChatShoppingRulesTool(onRequested)`，工具名 `get_shopping_rules`。
- `chat-records/service/chat-records.service.ts`：在 JSON/SSE 共用数组中直接注册工厂。

目录只被工具读取，trace 可引用本模块 DTO 中的合法主题/固定版本校验，不导入业务私有 Entity 或完整规则正文。

## 输入、结果与目录

输入为 `z.strictObject({ topic: shoppingRulesTopicSchema })`，topic 必填、无默认、无转换，导出 `z.input` 和 `z.output`。结果严格实现契约的 discriminated union，内部 topic 和请求 topic 必须一致。

目录键使用五类 topic 的类型约束保证完整；对象内容以只读声明表达，返回新数组/对象避免调用方污染共享目录。来源 ID 使用固定枚举，不做文件路径解析。

工具执行：

1. schema 校验后立即调用同步 `onRequested` 设置本轮来源标志。
2. 读取选定主题；显式列出输出字段并复制数组。
3. 按严格结果 schema 校验，并核对主题一致。
4. 返回 JSON 字符串；任何读取/校验异常固定 unavailable，不能回传原异常。

本工具没有 HTTP Controller、Body/Query/Param，不新增 Pipe/Swagger DTO 或 HTTP 400 映射。未知主题属于工具输入错误。

## 固定目录内容

发布版本 `2026-11-17.v1`，scope 为 `site_capabilities`，source 为 `approved_project_contracts`。五类正文遵循契约，不允许模型输入正文、来源、版本或政策 URL。

来源文件与运行目录分工：

- 契约文档说明事实和治理，目录保存实际供模型读取的安全正文。
- 运行时不假定 Markdown 链接或文档索引会进入模型；正文必须由工具实际返回。
- 无热加载、自动文件遍历、网络读取、政策生成、缓存刷新或外部文本注入。
- 修改业务事实时，同步修改对应来源、目录、schema 固定版本和交付文档；未确认的政策不放入目录。

## 运行资格和隐私

- 复用 `detailQueryRequested` 标记；任何经校验调用都在首个异步操作前标记，包含失败。沿用原事务设置两条消息资格并跳过提取入队，下一轮重置。
- 加入隐藏历史名单并扩展嵌套调用 ID 收集，隐藏独立、非法、原生 `function.name` 编码与具名孤立结果。
- trace 输入按 topic schema 白名单，非法输入投影 `{}`；成功结果只保留 `ok/topic/version/itemCount`，计数 1–5；失败及异常固定 unavailable。
- 独立调用、嵌套模型调用、非法调用和结果 content/payload 均须安全投影；不保存规则正文、notice、引用数组或自由文本。
- activity 沿用 input/output null；不新增 UI 状态或可执行卡片。
- 系统上下文和售后流程说明适用主题、固定来源、未知政策限制及“功能未接入不等于无权售后”。

## 验证

用户“先不做测试”继续有效，不新增或执行 spec、集成、数据库、真实模型或浏览器验收。主代理完成定向 Prettier、API typecheck/build、`git diff --check` 及源码边界审阅。

后续测试应覆盖五主题内容/版本、拒绝未知输入、固定失败、不同传输的实际工具往返、trace/history 和整轮记忆排除；当前全部明确为未执行。
