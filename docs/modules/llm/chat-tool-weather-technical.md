# 聊天天气查询技术文档

## 实现目标

- 状态：已确认并实现。
- 在现有聊天每轮工具中提供 `get_weather_forecast(city)`，通过 XingYuWeather SSE MCP endpoint 查询近 3 天预报。
- MCP 工具仅作为外部数据适配；模型看到的是项目自有 schema 与白名单投影，不直接暴露 MCP 原始工具。
- endpoint 缺失或天气 MCP 暂不可用时不影响无天气查询的普通聊天。

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
- 连接使用 `MCPAdapter` 的 `servers` 配置、`transport: "sse"`、`mode: "legacy"`、`listTools()` 和 `close()`；关闭 server name 前缀以使用实测工具名 `predict`。
- XingYuWeather SSE endpoint 由 `WEATHER_MCP_URL` 配置，必须精确匹配批准的 HTTPS 主机和路径，阻止 SSRF 或透传凭据。
- 天气查询不使用 OpenWeatherMap Key；本功能不读取 `OPENWEATHER_API_KEY`。
- XingYuWeather 实测 MCP 工具为 `predict`，输入 schema 为 `{ city: string }`。其返回内容为文本化 Python dict，含 `results[].location` 与 `results[].daily[]`；受限解析失败时安全降级。

## 接口和依赖注入

- `WeatherMcpPort` 对外只提供 `isEnabled()` 与 `getForecast(city)`，不把 `MCPAdapter` 类型暴露到 `chat-records`。
- `LlmModule` 注册 `WeatherMcpService`；应用 shutdown 时调用 `MCPAdapter.close()`，确保 SSE 资源释放。
- `ChatRecordsService` 每轮装配一个项目自有 `get_weather_forecast` 包装工具，并通过 Port 调用天气服务；不直接注入 MCP 私有对象。
- `LLM_ENABLE_REMOTE_TOOLS=true` 且 `WEATHER_MCP_URL` 合法时注册工具。环境未配置时不注册；配置可用但 endpoint 运行时断连时工具返回统一失败。
- MCP 工具发现采用懒连接：包装工具在首个天气工具调用时才发现远程工具，不让 API 启动依赖第三方可用性。发现结果按 client 生命周期缓存；发现超时/失败时关闭 adapter 并允许后续轮重试。
- 发现和工具调用均设 10 秒超时；每轮至多调用一次。

## 状态、流程或持久化

```text
用户明确给出城市
  -> LangGraph 模型调用 get_weather_forecast
  -> 本地 Zod schema 校验 city
  -> WeatherMcpService 通过 SSE 调用 predict({ city })
  -> 解析 MCP 文本结果并校验结构、数量、日期和数值
  -> 投影成最多 3 日的固定 JSON
  -> ToolNode 将安全结果交给模型生成回答
```

- MCP tool discovery 可缓存；天气数据不在 API 内额外持久化。
- 查过天气的轮次设置现有 `detailQueryRequested`/来源隔离标记，确保整轮不参与自动记忆和摘要来源；trace 只保留成功状态和预报天数，不持久化城市及天气明细；下一普通轮恢复。
- 不新增实体、迁移、HTTP API 或前端事件。

## 请求 Schema、校验和错误映射

- `weatherForecastInputSchema` 位于 `chat-records/dto/weather-forecast.dto.ts`，使用 `z.strictObject`，`city` 必填、trim 后 1–100 字符，拒绝 URL、坐标串及额外字段。
- 工具输入是模型发出的 LangChain tool schema，不是 Controller HTTP Body；因此不新增 Controller、DTO Swagger 或 Nest Validation Pipe。
- 供应商输出运行时按 unknown 解析：只接受预期的 `results` 数组、`location`、`daily` 数组与 `last_update`；最多取前三天。日期使用严格 `YYYY-MM-DD`，数值字段转换失败时按契约失败或 `null`，绝不猜单位。
- XingYuWeather 的 MCP 文本为 Python 风格字典；使用 `yaml` failsafe schema 解析其兼容子集，不启用自定义标签、别名或 merge，并限制 32 KiB、12 层及 2,000 个节点；不使用 `eval` 或执行返回文本。
- `high`/`low` 作为摄氏温度、`precip` 作为毫米；上游未声明 `wind_speed` 单位，故 `windSpeedKmh` 固定为 `null`，不猜单位。
- 外部连接、协议、超时、城市无结果、输出解析或 schema 错误统一返回 `{ ok: false, code: "unavailable" }`。工具边界捕获异常，不回传原始消息、URL、响应或栈。

## 安全和可观测性

- 天气城市只来自本轮用户明确输入或确认，不通过 IP、浏览器、地址簿或长期记忆推断。
- 不把第三方 Key 配进 MCP 或传入模型；当前 XingYuWeather endpoint 无鉴权参数。
- 禁止日志/trace/activity/history 记录完整 MCP 请求、响应和异常；持久化 trace 只保留固定状态及有界预报天数。
- 不允许 MCP 返回的描述覆盖系统/开发指令；内容作为不可信天气数据使用。输出字段白名单避免远端任意文本进入 trace/activity。
- 远程 endpoint 固定 HTTPS allowlist；非预期 host 的配置启动时拒绝。

## 测试方案

- 输入 schema：空城市、空白、长度边界、超长、URL/坐标、额外字段。
- 结果投影：合法 1/3 日结果、超出 3 日截断、空结果、错误日期、非法数值、缺可选字段、不可信额外字段。
- MCP adapter：首次 discovery、工具缺失、超时/断连、safe failure、client close；使用 fake MCP server/client，不调用真实天气供应商。
- ChatRecordsService：工具注册/未注册条件、每轮一次、查询轮记忆与摘要隔离、下一轮恢复。
- JSON/SSE 集成沿用现有 fake model + 实际 ToolNode harness，断言模型收到安全投影、trace/activity 无原始 MCP 内容、失败不生成伪造天气。
- 外部 ModelScope endpoint Smoke Test 单独运行，不纳入默认自动化测试；不输出凭据。

## 验证命令

- `pnpm format:check`
- `pnpm --filter @clothes-shopping-guide/api typecheck`
- `pnpm --filter @clothes-shopping-guide/api test`
- `pnpm --filter @clothes-shopping-guide/api build`
- `pnpm check`
- 外部 SSE Smoke Test：MCP Inspector `tools/list` 和 `predict({ city })`，仅手动执行并单独记录，不将外部当前可用性当作稳定 CI 断言。

## 已知限制

- MCP Adapter SSE 工具调用结果在本地锁定版本中的实际 content 结构。
- ModelScope 示例中的 `wind_speed` 单位仍未证实；当前安全返回 `null`，不映射成 km/h。
- XingYuWeather 上游数据授权、可用性承诺、限流和服务条款；当前仅证明测试时 endpoint 可调用，不构成 SLA 或数据授权确认。
