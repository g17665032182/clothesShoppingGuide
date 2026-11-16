# 流式聊天模块技术文档

## 状态与上下文

- 状态：已确认
- 关联设计文档：[流式聊天模块设计文档](./chat-streaming-design.md)
- 关联 CRUD 契约：[流式聊天 CRUD 契约](../../contracts/chat-streaming-crud-contract.md)
- 所属应用：`apps/api`、`apps/web`
- 当前技术栈：NestJS 12、LangChain.js、Vue 3、Axios 1.20
- 最后更新：2026-10-28

## 实现目标

将现有阻塞式聊天请求改为逐段响应，同时保留会话上下文、归属校验和成功后持久化行为。前端使用项目已有 Axios API 层发起 POST 流式请求，解析 SSE 事件并更新页面级消息状态。

## 目录与职责

### 后端

```text
apps/api/src/llm/
  llm.service.ts                 # 复用模型配置，保留旧调用和新增模型流入口
  llm.graph.ts                   # 保持旧 JSON 调用的 LangGraph 执行入口
apps/api/src/chat-records/
  chat-records.service.ts        # 编排上下文、模型流事件、事务保存和 done 元数据
  llm-chat.controller.ts         # 绑定请求、用户和 HTTP/SSE 响应写入
```

- `LlmService` 和 LangGraph 持有模型流能力，不访问数据库。
- `ChatRecordsService` 只负责预校验、上下文准备、调用模型、聚合完整回复、事务持久化并产出领域流事件，不持有 Express Response。
- Controller 只处理 HTTP 响应头、SSE 帧写入、背压、断连检测和调用 Service。
- `ChatRecordsModule` 继续复用已注册的 `LlmModule`，不重复实例化模型。

### 前端

```text
apps/web/src/api/
  index.ts                       # 复用 Axios 实例、认证刷新和请求错误映射
  modules/chat.ts                # 会话 REST API、SSE 请求和帧解析
  types/chat.ts                  # 会话、消息和流事件类型
apps/web/src/pages/chat/
  page.ts                        # 会话加载、切换、发送、取消和页面状态
  index.vue                      # 页面结构与事件绑定
  mock-data.ts                   # 联调后删除不再使用的模拟数据
```

页面不得直接使用 Axios 或自行解析网络字节流；HTTP 和 SSE 解析集中在聊天 API 模块。接口 UUID、ISO 时间和页面展示字段在该模块中完成映射。

## 依赖和官方文档

- 复用已安装的 `@langchain/core`、`@langchain/langgraph`、`@langchain/openai`、NestJS 和 Axios，不新增传输库。
- LangChain 官方文档确认 Chat Model 支持异步流迭代；流式接口显式调用现有 `BaseChatModel.stream()`，不改变旧 JSON 路由使用的 `LangGraph.invoke()`。
- `LlmService.stream()` 返回模块自有的异步事件/结果结构，调用方不依赖 LangChain message 对象；文本 chunk 通过统一标准化函数提取，usage 在可用时累积，否则返回 `null`。
- Axios Fetch adapter 支持 `responseType: 'stream'` 并返回 Fetch `ReadableStream`；发起流式请求时显式选择 Fetch adapter，不能走浏览器默认 XHR adapter。
- SSE 使用标准文本帧格式；前端解析器必须支持任意字节边界、CRLF/LF 行结束、多字节 UTF-8 字符跨 chunk 和最后一个未带换行的缓冲区。

## 后端调用与持久化流程

1. JWT Guard 和 DTO ValidationPipe 在 Controller handler 执行前完成认证、校验。
2. `ChatRecordsService` 完成会话归属、历史读取、上下文压缩和模型配置预校验；这些步骤抛出的 HTTP 异常仍由 Nest 返回 JSON。
3. Controller 在预校验成功后设置 `Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache, no-transform` 和 `X-Accel-Buffering: no`，不发送心跳，并写入 `start`。
4. `ChatRecordsService` 返回异步领域事件；Controller 将事件编码为 SSE 帧并写入 Node response，背压时等待 `drain`。
5. `LlmService.stream()` 调用 `BaseChatModel.stream()`，聚合文本和 usage；取消信号通过 LangChain runnable config 传递，provider 不支持时停止读取并阻止持久化。
6. 模型迭代完成且未在事务开始前取消后，在单个 MikroORM 事务中保存 user 和完整 assistant 消息及摘要状态。
7. 事务成功后发送唯一的 `done` 事件并结束响应；事务开始后断连不强制回滚，客户端通过会话 ID核实结果。

新会话实体只在模型成功后创建，并在保存事务中与消息一同提交。已存在的会话在流式生成期间不得提前写入新的消息或摘要状态；提交前发生错误应保留数据库原状。

## HTTP、SSE 与错误处理

- SSE 每帧格式为 `event: <name>\ndata: <JSON>\n\n`，JSON 编码统一通过 `JSON.stringify`，不拼接未转义用户文本。
- `delta` 只发送文本内容；不得向客户端透传 LangChain message 对象、工具调用参数、供应商响应元数据或密钥。
- 响应头发送前的异常交给现有 Nest 异常过滤器，返回对应 HTTP 状态和 JSON 错误。
- 响应头发送后不再抛出期望由 Nest 转换的 HTTP 异常；将错误映射为白名单中的公开消息，以 `error` 帧发送后结束响应。
- 持久化失败必须发送 `error` 而不是 `done`；若连接已关闭则只记录状态，客户端按未知结果处理。
- 写入时处理 `response.write()` 的背压；客户端连接关闭时立即停止继续写入。
- 错误日志保留 request id、阶段和异常分类，不记录 Prompt、消息全文、摘要、API Key 或供应商原始响应。

## 取消与资源清理

- 前端为每次发送创建独立 `AbortController`，将 signal 传给 Axios。
- 切换会话、开始新会话或页面卸载时中止当前请求，并使旧请求的回调失效。
- Axios Fetch adapter 的取消只保证取消客户端请求；后端监听 `request.aborted` 和未完成响应的 `response.close`，将取消信号传给 LangChain `stream()`。
- 如果当前 provider 不支持取消，仍需停止读取 chunk、停止 SSE 写入并确保不进入数据库持久化。
- 断连事件监听器、AbortController、流 reader/iterator 和响应结束路径必须在 `finally` 中清理，避免重复发送 `error` 或结束响应。

## 前端 SSE 解析与状态

- 通过 Axios Fetch adapter 发起请求，设置 `responseType: 'stream'`、Bearer Token、JSON body、`signal`，并请求 `text/event-stream`；流式接口使用 `/llm/chat/stream`。
- 检查 HTTP 状态、Content-Type 和 response data 存在性；对非 SSE 代理/网关错误正文使用现有错误映射。
- 使用 `TextDecoder` 的流式解码模式将 Uint8Array 转为文本，使用缓冲区按空行拆帧，再解析 `event` 和 `data` 行并 JSON 解码。
- 事件必须按 CRUD 契约校验；忽略空行和注释行，未知事件不改变业务状态；畸形 JSON 作为流协议错误处理。
- 页面状态按 `idle`、`loading`、`streaming`、`success`、`error` 区分；响应文本尚未 `done` 前不能标记成功。
- 收到 `delta` 时只更新与该请求绑定的 assistant 占位；收到 `done` 后将会话 ID 和标题并入当前页面，并刷新列表。
- 收到 `error`、解析错误、网络错误或意外 EOF 时保留已收到文本并标记未完成；不将临时 assistant 内容加入正式历史缓存。
- 成功后重新加载当前会话详情或以服务端返回的完整持久化消息更新本地状态，保证前端与数据库内容一致。

## 认证刷新和并发

- 流式请求通过现有 API 层公开一个专用流请求函数，沿用 token 注入和认证传输回调。
- Fetch 流式请求收到 401 时，先复用单飞 Refresh Token 流程，再使用相同请求体和未取消的 signal 重试一次；若已收到响应字节则不重试。
- 不自动重试已经收到响应体字节的流式请求，避免重复生成和重复保存；仅在获得流响应前刷新重试。
- 页面同一时刻最多执行一个生成请求；发送按钮、停止按钮和输入状态与请求状态一致。
- 会话切换通过请求序号或会话 ID 守卫，确保旧响应不会污染新会话。

## 测试方案

### 后端

- LangChain/model stream 将多个 chunk 原样按序产出并聚合为完整文本。
- 服务编排逐 chunk 输出；完成后事务保存两条消息；事务失败不发 `done`。
- 模型异常、流异常和客户端取消均不产生半轮记录。
- 新会话仅在成功路径创建；已有会话归属和上下文压缩行为保持不变。
- Controller 验证 SSE headers、帧编码、背压、连接断开和公开错误映射。

### 前端

- SSE 解析覆盖任意 chunk 边界、CRLF、UTF-8 多字节字符、多个事件粘连、末尾残留帧、未知事件和畸形 JSON。
- Axios mock 验证 Fetch adapter、认证头、refresh 重试、AbortSignal 和错误响应。
- 页面逻辑通过类型检查、构建和手工 Smoke Test 验证真实会话列表/详情加载、增量渲染、完成更新、失败状态、取消及旧响应隔离。
- 本次不安装 Vitest、Vue Test Utils 或 Playwright；后端既有 Node test 保持执行，前端自动化测试另行立项。

## 验证命令

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm check
pnpm --filter @clothes-shopping-guide/api build
```

同时验证 `/api/docs-json` 包含 `/api/llm/chat/stream` 的 `text/event-stream` 响应描述。Smoke Test 需使用本地 API、数据库和已配置模型，分别验证正常流、授权错误、模型失败、中止请求、状态未知核实及历史读取。不得在文档或日志中输出第三方凭据。
