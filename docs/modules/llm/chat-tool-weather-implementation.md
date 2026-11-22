# 聊天近 3 天天气查询实施文档

## 开发流程总览

- 状态：已切换至高德地图 stdio MCP，等待有效 `AMAP_MAPS_API_KEY` 后进行外部验收。
- 原实施方案曾通过 XingYuWeather SSE 查询；2026-11-23 按用户最新指示改为本地启动 `@amap/amap-maps-mcp-server`。
- 新链路调用 `maps_weather({ city })`，仅向模型返回项目自有白名单结果；不复用或保存此前对话中暴露的凭据。

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
- 本地配置使用固定版本 `@amap/amap-maps-mcp-server@0.0.8` 的 stdio transport 和 `maps_weather` 工具；Render Blueprint 默认关闭远程工具，并将 `AMAP_MAPS_API_KEY` 作为 Secret 槽位。启用前需在 Render 配置有效 Key。
- 已更新天气能力清单、LLM 系统上下文、README、环境模板和本实施记录。
- 未新增数据库实体、迁移、公开 HTTP API、前端功能或订单/地址/定位权限。

## 按顺序排列的实施阶段

1. **依赖与响应核实（已完成）**
   - 阅读仓库本地包文档及适配器官方文档，确认 MCP 包版本、stdio 调用响应结构、工具 timeout 和 close 生命周期。
   - 核对天气数据字段和单位。来源未提供或无法确认时对应字段留为 `null`，不做猜测。
   - 检查当前可用解析依赖。若 MCP content 只有 Python dict 文本，优先使用现成且安全的解析库；没有合适库时先停止并重新评审技术文档，不使用 `eval`、`Function` 或不受限自制解析器。
2. **适配器与配置（已完成）**
   - 添加 `@langchain/mcp-adapters` 并更新 lockfile。
   - 实现配置校验、HTTPS host 限制、惰性工具发现、MCP 超时、统一错误分类和 Nest shutdown 清理。
   - 为 client/provider 编写完全使用 fake transport 的单元测试。
3. **聊天工具与安全投影（已完成）**
   - 新增 `get_weather_forecast(city)` Zod schema 和包装工具。
   - 固定调用 MCP `maps_weather`，最多保留 3 天且只输出契约白名单字段；限制原始返回字节、结构深度和数组长度。
   - 实现每轮一次、失败安全结构及天气查询来源隔离；不在日志、trace/activity 写入完整 MCP 参数/结果/异常。
4. **聊天链路集成（已完成）**
   - 按配置开关与 API Key 装配工具；未配置时不注册，MCP 运行时故障不影响未请求天气的普通对话。
   - 使用现有 fake model + 实际 ToolNode 覆盖 JSON、SSE、trace/history、记忆/摘要隔离与下一轮恢复。
5. **最终验证与交付（已完成）**
   - 串行执行格式、API typecheck、API 测试、API build、`pnpm check` 和 `git diff --check`。
   - 手动执行高德 MCP smoke test，记录工具发现与指定城市返回情况；该外部检查不作为稳定 CI 依赖。
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
- 历史真实 MCP smoke test：2026-11-19 曾经由 XingYuWeather SSE 成功查询上海近三天预报；这不代表新高德 stdio 链路已验证。
- 数据库、迁移、默认开发库和浏览器登录流程未运行。

## 供应商切换记录（2026-11-23）

- 已将适配器改为本地 stdio，调用固定包版本 `@amap/amap-maps-mcp-server@0.0.8` 的 `maps_weather` 工具；按高德天气字段映射最高/最低温、天气描述和风向，不提供来源缺失的降水量、湿度及风速单位。
- `AMAP_MAPS_API_KEY` 仅通过环境变量传给子进程，Render Blueprint 提供 Secret 配置项；未将用户消息中的任何凭据写入仓库。
- 尚未配置有效 API Key，未执行高德外部 Smoke Test；API Key 需在 Render Secret 中配置后再验收。

## 风险和停止条件

- 高德 API Key 缺失时天气工具保持未注册；当前等待有效 Key 后做真实供应商验收。
- `wind_speed` 单位无法从可信说明或响应元数据确认，当前 `windSpeedKmh` 返回 `null`，不映射为 km/h。
- MCP 返回 Python 风格映射文本，已使用受限的 YAML failsafe schema 安全解析；不执行返回文本。
- 若 npx 安装或 stdio 生命周期与锁定版本不兼容，暂停并重新评估，不绕过 MCPAdapter 自行实现协议。
- 不运行真实默认数据库迁移、`migration:fresh`、持久化用户数据写入或任何会打印真实环境变量的命令。
