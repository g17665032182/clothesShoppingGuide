# 聊天天气查询技术文档

## 实现目标

- 状态：按用户最新配置切换为本地 stdio MCP，等待有效高德 API Key 后验收。
- 在现有聊天每轮工具中提供 `get_weather_forecast(city)`，通过 `@amap/amap-maps-mcp-server` 查询天气。
- MCP 工具仅作为外部数据适配；模型看到的是项目自有 schema 与白名单投影，不直接暴露 MCP 原始工具。
- API Key 缺失或天气 MCP 暂不可用时不影响无天气查询的普通聊天。

## 包和目录结构

```text
apps/api/src/llm/
  weather-mcp/
    weather-mcp.port.ts          # 供聊天层使用的窄 Port 与数据类型
    weather-mcp.service.ts       # MCPAdapter 生命周期、连接和响应投影
    weather-mcp.service.spec.ts  # 配置与响应投影测试
apps/api/src/chat-records/
  tools/chat-weather-forecast.tool.ts  # 面向模型的稳定工具 schema 和安全输出
  dto/weather-forecast.dto.ts         # 输入/输出 Zod schema
```

聊天隔离、trace 和历史回归测试位于所属 `spec/` 目录，不新增独立数据库模块。

## 依赖和官方文档

- 使用 `@langchain/mcp-adapters` 与 `yaml`；沿用项目已有 LangChain Core、LangGraph 和 `ToolNode`，不新增 MCP 协议底层实现。
- 连接使用 `MCPAdapter` 的 `servers` 配置、`transport: "stdio"`、`listTools()` 和 `close()`；关闭 server name 前缀以调用 `maps_weather`。
- 子进程固定运行 `npx -y @amap/amap-maps-mcp-server@0.0.8`；仅将 `AMAP_MAPS_API_KEY` 注入子进程环境。
- `maps_weather` 输入为 `{ city: string }`；只读取 `city` 与 `forecasts[]` 中日期、天气描述、昼夜温度和风向等字段，受限解析失败时安全降级。

## 接口和依赖注入

- `WeatherMcpPort` 对外只提供 `isEnabled()` 与 `getForecast(city)`，不把 `MCPAdapter` 类型暴露到 `chat-records`。
- `LlmModule` 注册 `WeatherMcpService`；应用 shutdown 时调用 `MCPAdapter.close()`，确保 stdio 子进程退出。
- `ChatRecordsService` 每轮装配一个项目自有 `get_weather_forecast` 包装工具，并通过 Port 调用天气服务；不直接注入 MCP 私有对象。
- `LLM_ENABLE_REMOTE_TOOLS=true` 且 `AMAP_MAPS_API_KEY` 非空时注册工具。环境未配置时不注册；子进程启动或上游 API 失败时工具返回统一失败。
- MCP 工具发现采用懒连接：包装工具在首个天气工具调用时才启动子进程，不让 API 启动依赖 npm registry 或高德服务。发现结果按 client 生命周期缓存；发现超时/失败时关闭 adapter 并允许后续轮重试。
- 工具调用设 10 秒超时，首次发现设 30 秒以容纳 npx 冷启动；每轮至多调用一次。

## 状态、流程或持久化

```text
用户明确给出城市
  -> LangGraph 模型调用 get_weather_forecast
  -> 本地 Zod schema 校验 city
  -> WeatherMcpService 通过 stdio 调用 maps_weather({ city })
  -> 解析 MCP JSON 文本并校验结构、数量、日期和数值
  -> 投影成最多 3 日的固定 JSON
  -> ToolNode 将安全结果交给模型生成回答
```

- MCP tool discovery 可缓存；天气数据不在 API 内额外持久化。
- 查过天气的轮次设置现有 `detailQueryRequested`/来源隔离标记，确保整轮不参与自动记忆和摘要来源；trace 只保留成功状态和预报天数，不持久化城市及天气明细；下一普通轮恢复。
- 不新增实体、迁移、HTTP API 或前端事件。

## 请求 Schema、校验和错误映射

- `weatherForecastInputSchema` 位于 `chat-records/dto/weather-forecast.dto.ts`，使用 `z.strictObject`，`city` 必填、trim 后 1–100 字符，拒绝 URL、坐标串及额外字段。
- 工具输入是模型发出的 LangChain tool schema，不是 Controller HTTP Body；因此不新增 Controller、DTO Swagger 或 Nest Validation Pipe。
- MCP 输出运行时按 unknown 解析：只接受天气城市及 `forecasts[]` 中逐日数据；最多取前三天。日期使用严格 `YYYY-MM-DD`，数值字段转换失败时按契约失败或 `null`，绝不猜单位。
- MCP 可能以文本形式返回 JSON；使用 `yaml` failsafe schema 解析兼容子集，不启用自定义标签、别名或 merge，并限制 32 KiB、12 层及 2,000 个节点；不使用 `eval` 或执行返回文本。
- 高德 `daytemp`/`nighttemp` 作为最高/最低摄氏温度；MCP 未提供降水量、湿度和可确认单位的风速时均返回 `null`，不猜单位。
- 外部连接、协议、超时、城市无结果、输出解析或 schema 错误统一返回 `{ ok: false, code: "unavailable" }`。工具边界捕获异常，不回传原始消息、URL、响应或栈。

## 安全和可观测性

- 天气城市只来自本轮用户明确输入或确认，不通过 IP、浏览器、地址簿或长期记忆推断。
- 高德 API Key 仅通过 `AMAP_MAPS_API_KEY` 注入固定 MCP 子进程；不进入模型、trace、activity、history 或应用日志。
- 禁止日志/trace/activity/history 记录完整 MCP 请求、响应和异常；持久化 trace 只保留固定状态及有界预报天数。
- 不允许 MCP 返回的描述覆盖系统/开发指令；内容作为不可信天气数据使用。输出字段白名单避免远端任意文本进入 trace/activity。
- 子进程命令、包名和版本在源码中固定，不能由用户请求或环境变量替换。

## 测试方案

- 输入 schema：空城市、空白、长度边界、超长、URL/坐标、额外字段。
- 结果投影：合法 1/3 日结果、超出 3 日截断、空结果、错误日期、非法数值、缺可选字段、不可信额外字段。
- MCP adapter：首次 discovery、工具缺失、超时/断连、safe failure、client close；使用 fake MCP server/client，不调用真实天气供应商。
- ChatRecordsService：工具注册/未注册条件、每轮一次、查询轮记忆与摘要隔离、下一轮恢复。
- JSON/SSE 集成沿用现有 fake model + 实际 ToolNode harness，断言模型收到安全投影、trace/activity 无原始 MCP 内容、失败不生成伪造天气。
- 高德 MCP Smoke Test 单独运行，不纳入默认自动化测试；不输出凭据。

## 验证命令

- `pnpm format:check`
- `pnpm --filter @clothes-shopping-guide/api typecheck`
- `pnpm --filter @clothes-shopping-guide/api test`
- `pnpm --filter @clothes-shopping-guide/api build`
- `pnpm check`
- 外部 MCP Smoke Test：发现 `maps_weather` 并以指定城市调用；仅手动执行并单独记录，不将外部当前可用性当作稳定 CI 断言。

## 已知限制

- MCP Adapter stdio 工具调用结果结构及 npx 首次下载时间需通过隔离的外部 Smoke Test 确认。
- 高德 MCP 上游数据授权、可用性承诺、限流和服务条款；需在用户配置有效 API Key 后重新执行外部验收。
