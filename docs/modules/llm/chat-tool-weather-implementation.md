# 聊天近 3 天天气查询实施文档

## 开发流程总览

- 状态：已实现并完成验证
- 已确认设计与天气工具契约；已确认 `@dangahagan/weather-mcp` 与 XingYuWeather 的对比结果，并选择 XingYuWeather。
- 已确认技术方案：通过 XingYuWeather 的 SSE MCP endpoint 调用 `predict({ city })`，只向模型返回项目自有白名单结果。
- 实施文档已于 2026-11-19 获得确认；主代理完成依赖、环境配置、API 接线、自动化测试、真实 MCP smoke test 和最终验证。

## 子代理角色和文件所有权

- 本任务由主代理串行实施，不启用子代理：工作量集中在 LLM MCP 适配、聊天工具装配和相关安全测试；MCP 生命周期、构建目录及外部 Smoke Test 需要单一集成者协调。
- 主代理拥有所有实施文件，并负责依赖和 lockfile、应用模块/Provider 接线、最终审查与验证。
- 实施期间不并行执行会共享 `node_modules`、构建输出、外部 MCP endpoint 或测试数据库的任务。

## 子代理开始前检查

不适用。本任务不分派子代理。

## 子代理完成报告

不适用。本任务不分派子代理。

## 主代理集成任务

- 复核技术文档中标记的实现前停止条件；不猜测天气单位，不执行 MCP 返回文本中的任何内容。
- 已复用官方 `@langchain/mcp-adapters` 与项目现有 LangGraph `ToolNode`；添加 `yaml` failsafe 解析依赖处理服务文本结果。
- `llm` 层通过 `WeatherMcpPort` 管理懒连接和 SSE 生命周期；`chat-records` 不依赖 MCP adapter 私有实现。
- 已注册 `get_weather_forecast`，严格校验城市、每轮限一次、白名单输出并统一安全降级。
- JSON/SSE 共用天气工具和来源隔离；历史隐藏天气调用及结果，下一普通轮恢复记忆/摘要来源。
- 已配置 `WEATHER_MCP_URL` 和本地远程工具开关；移除了本功能不使用的 OpenWeatherMap Key 环境变量，真实 Key 不写入仓库文件。
- 已更新天气能力清单、LLM 系统上下文、README、环境模板和本实施记录。
- 未新增数据库实体、迁移、公开 HTTP API、前端功能或订单/地址/定位权限。

## 按顺序排列的实施阶段

1. **依赖与响应核实（已完成）**
   - 阅读仓库本地包文档及适配器官方文档，确认依赖版本、SSE 调用响应结构、工具 timeout 和 close 生命周期。
   - 核对 XingYuWeather `wind_speed` 单位与上游服务条款。单位无法确认时将 `windSpeedKmh` 留为 `null`，不做转换。
   - 检查当前可用解析依赖。若 MCP content 只有 Python dict 文本，优先使用现成且安全的解析库；没有合适库时先停止并重新评审技术文档，不使用 `eval`、`Function` 或不受限自制解析器。
2. **适配器与配置（已完成）**
   - 添加 `@langchain/mcp-adapters` 并更新 lockfile。
   - 实现配置校验、HTTPS host 限制、惰性工具发现、MCP 超时、统一错误分类和 Nest shutdown 清理。
   - 为 client/provider 编写完全使用 fake transport 的单元测试。
3. **聊天工具与安全投影（已完成）**
   - 新增 `get_weather_forecast(city)` Zod schema 和包装工具。
   - 固定调用 MCP `predict`，最多保留 3 天且只输出契约白名单字段；限制原始返回字节、结构深度和数组长度。
   - 实现每轮一次、失败安全结构及天气查询来源隔离；不在日志、trace/activity 写入完整 MCP 参数/结果/异常。
4. **聊天链路集成（已完成）**
   - 按配置开关与 URL 可用性装配工具；未配置时不注册，MCP 运行时故障不影响未请求天气的普通对话。
   - 使用现有 fake model + 实际 ToolNode 覆盖 JSON、SSE、trace/history、记忆/摘要隔离与下一轮恢复。
5. **最终验证与交付（已完成）**
   - 串行执行格式、API typecheck、API 测试、API build、`pnpm check` 和 `git diff --check`。
   - 手动执行 ModelScope SSE smoke test，记录工具发现与指定城市返回情况；该外部检查不作为稳定 CI 依赖。
   - 审查差异，确认无 Key、无不必要的数据库或用户数据变更，更新能力清单和实施记录。

## 验收标准

- 已登录聊天用户明确指定城市后，模型可调用 `get_weather_forecast` 并获得最多三日、字段白名单内的预报参考。
- 工具与供应商响应明确区分预报和实况；没有把预测数据称为实时观测。
- MCP 未配置、连接失败、超时、工具缺失、城市无结果或返回结构不兼容时，结果为安全失败，不产生伪天气事实，也不暴露 Key、原始异常或非白名单数据。
- 无天气工具请求的普通聊天不依赖远程 MCP 在线。
- 天气调用轮按契约排除自动记忆和摘要来源，后续普通轮恢复正常来源资格。
- JSON 和 SSE 共用相同行为；trace/activity/history 不泄露供应商原文。
- trace 仅持久化天气工具状态及有界预报天数；不保存城市、天气描述或温度明细。
- 适配器资源随 Nest 应用关闭而释放；没有默认测试对真实远程天气服务的网络依赖。
- 依赖、环境变量示例、文档索引和实施结果同步更新；无数据库迁移和公开 API 变更。
- 报告清晰区分自动化验证、外部 smoke test、未执行项和外部服务风险。

## 已完成验证

- `pnpm --filter @clothes-shopping-guide/api test`：411 项中 394 通过、0 失败、17 项 PostgreSQL/Migration 门控跳过；跳过项未计为通过。
- `pnpm --filter @clothes-shopping-guide/api typecheck`：通过。
- `pnpm --filter @clothes-shopping-guide/api build`：通过。
- `pnpm check`：通过，包含全仓 Prettier、递归类型检查和 API/Web/shared 构建。
- `git diff --check`：通过。
- trace/history 专项回归：58 项通过、0 失败；trace 仅留状态与预报天数，后续历史隐藏天气调用和结果。
- 真实 MCP smoke test：使用项目 `WeatherMcpService` 经 XingYuWeather SSE 查询上海，成功返回 3 天，首日 `2026-11-19`。本次上游响应未提供更新时间，`updatedAt` 安全返回 `null`；风速单位未确认，`windSpeedKmh` 为 `null`。
- 数据库、迁移、默认开发库和浏览器登录流程未运行。

## 风险和停止条件

- ModelScope 是第三方托管 SSE endpoint；目前的手工成功结果不构成 SLA、数据授权或持续可用性保证。
- `wind_speed` 单位无法从可信说明或响应元数据确认，当前 `windSpeedKmh` 返回 `null`，不映射为 km/h。
- MCP 返回 Python 风格映射文本，已使用受限的 YAML failsafe schema 安全解析；不执行返回文本。
- 若 SSE transport、连接重试或 client 生命周期与锁定版本不兼容，暂停并重新评估技术方案，不用临时底层协议实现绕过。
- 不运行真实默认数据库迁移、`migration:fresh`、持久化用户数据写入或任何会打印真实环境变量的命令。
