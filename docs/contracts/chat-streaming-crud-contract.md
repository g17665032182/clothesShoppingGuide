# 流式聊天 CRUD 契约

## 状态与上下文

- 状态：现有契约及 2026-11-03 AI Elements 设计关联扩展已确认。
- 资源名称：流式聊天传输
- 业务目的：通过流式响应逐段展示大模型回复，并在完整生成后复用现有聊天记录规则保存本轮消息。
- 关联设计文档：[流式聊天模块设计文档](../chat-streaming/chat-streaming-design.md)
- 所属应用：`apps/api`、`apps/web`
- 关联模块：`chat-records`、`llm`、`auth`
- 最后更新：2026-11-05（按用户要求扩展前端跨会话、跨路由后台生成，见[实施说明](../chat-streaming/background-generation.md)）。

## 范围

- 包含：`POST /api/llm/chat` 的流式响应协议、前端流式消费、请求取消和错误展示。
- 包含：模型完整生成后的 user/assistant 消息保存时机。
- 包含：流式模型工具调用片段的服务端聚合、工具执行、工具事件持久化和后续模型流。
- 包含：沿用现有会话列表、详情、删除和管理员查询接口。
- 不包含：断线续传、流重放和新模型供应商。

## API 契约

### 流式聊天

| 项目       | 约定                                            |
| ---------- | ----------------------------------------------- |
| 方法       | `POST`                                          |
| 路由       | `/api/llm/chat/stream`                          |
| 认证       | Bearer JWT，沿用现有 JWT Guard                  |
| 请求体     | 现有聊天 DTO：`messages`，可选 `conversationId` |
| 成功响应   | UTF-8 `text/event-stream`                       |
| 前端客户端 | Axios Fetch adapter，`responseType: 'stream'`   |

原有 `POST /api/llm/chat` 保持 JSON 响应和既有行为不变。

### 事件帧

每个事件使用标准 SSE 帧格式，以空行分隔：

```text
event: <event-name>
data: <JSON object>

```

| 事件    | 数据结构                                                                          | 发送时机                             |
| ------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| `start` | `{ "conversationId": "uuid", "title": "标题" }`                                   | 预校验完成后、模型调用前             |
| `delta` | `{ "content": "增量文本" }`                                                       | 模型产生可展示文本时                 |
| `done`  | `{ "conversationId": "uuid", "title": "标题", "model": "模型名", "usage": null }` | 完整生成且记录事务提交成功后         |
| `error` | `{ "message": "可公开的错误信息" }`                                               | 流开始后发生可公开的业务或上游错误时 |

补充约定：

- `delta` 必须按模型输出顺序发送；前端按顺序拼接，不重复覆盖。
- 模型输出中的 tool-call chunks、工具名称、参数和工具结果不发送为 `delta`；服务端聚合完整工具调用后执行工具，工具完成后继续发送后续可展示文本。
- 工具执行期间可以暂时没有 `delta`；前端不得将无增量解释为本轮完成。
- 工具执行期间不新增 SSE 心跳。
- `done.usage` 沿用现有用量结构；上游未返回用量时为 `null`。
- `done` 只发送一次，且必须是成功流的最后一个业务事件。
- 新会话在发送 `start` 前创建会话记录，以满足运行期间写入内部 trace 的外键约束。
- 服务端不发送内部 Prompt、API Key、数据库连接信息或上游原始错误。
- 不增加独立结束标记；缓存控制响应头按技术文档设置，不发送心跳事件。

### 2026-11-03 AI Elements 扩展（已确认）

确认依据：2026-11-03 用户回复“确认设计文档”，以下为该设计关联的接口扩展；须继续通过技术及实施文档审批后才能修改 API：

- `start` 新增 `contextWindowTokens: number`。
- 新增 `activity`：`{ activity: ChatActivity }`，只包含公开投影，不直接发送内部事件。
- `ChatActivity` 工具项：`{ type: "tool", id, toolName, status, input, output }`；
  status 为 `running | success | error | interrupted`，input 为安全 JSON 或 null，output 为安全字符串或 null。
- `ChatActivity` 推理项：`{ type: "reasoning", id, summary }`，仅包含供应商明确给出的公开摘要。
- 新增 `sources`：`{ sources: ChatSource[] }`，是本轮来源列表的完整快照，前端替换本轮列表。
- `ChatSource`：`{ id: string, title: string, url: string }`。id 在本轮内稳定，title 和 url 为非空字符串。
  仅采集真实工具结果或供应商结构化引用，按有效 URL 去重并保留首次出现顺序，不从正文自动提取。
  URL 只允许 HTTP/HTTPS 外部链接，不允许用户名密码或其他协议；不自动抓取链接内容。
- 没有真实来源时不发送虚假占位项，前端隐藏 Sources；不新增搜索能力或行内引用编号。
- `done` 新增 `context: { contextWindowTokens, inputTokens, outputTokens, usedTokens }`。
  Token 字段允许 null；最近一次最终模型调用的输入和输出均已知才计算 usedTokens，不累加工具循环或历史轮次。
- 工具调用和结果用同一 id 更新；正文仍通过 `delta` 逐片发送，工具调用块和原始 reasoning 不作为正文。
- 工具参数/结果经独立白名单投影，未知工具不公开原始参数或结果，失败只给安全错误。
- 本扩展取代此前“工具仅用于内部审计”的展示限制，系统指令、记忆上下文、内部错误及原始供应商对象仍不公开。
- 成功保存时拟在最后模型 trace 的 `payload.publicDisplay` 同事务绑定 assistantMessageId、activities、sources 和 context，供历史恢复；本扩展不提议新增 Entity 或 Migration。
  容量和查询可行性在技术阶段核验；若必须修改数据结构，先回到设计和契约确认。
- 所有新事件遵守取消、背压、旧请求隔离、唯一 done 与错误终止规则。
- 活动、来源和正文均属于同一轮运行；错误、取消或断流后，未完成工具不能继续显示运行中，临时数据不得当作已保存记录。
- Confirmation、Plan 和 Stack Trace 不在本期范围，不新增工具审批、计划事件或面向用户的堆栈输出。

关联 [AI Elements 设计文档](../chat-streaming/ai-elements-design.md)及[技术文档](../chat-streaming/ai-elements-technical.md)。设计阶段已确认，技术文档确认后再编写实施文档，实施文档确认后才能改代码。

## HTTP 错误与流内错误

### 响应开始前

认证、DTO 校验、会话不存在或越权等可在生成前完成的错误继续使用现有 HTTP 状态码和 JSON 错误响应，不建立新的错误码体系。所有此类预校验必须在响应头发送前完成。

### 响应开始后

- HTTP 状态码无法再修改，错误通过 `error` 事件传递。
- `error.message` 只返回用户可理解且不敏感的信息。
- 发送 `error` 后服务端结束响应，不再发送 `delta` 或 `done`。
- 网络断开且前端未收到 `done` 时，前端按未完成请求处理，不显示为成功。

## 持久化契约

- 普通文本 `delta` 阶段不逐片写入展示消息表。
- 模型节点完成一个流式响应后，服务端聚合并持久化模型响应；包含工具调用时先持久化调用事件，再执行工具。
- 工具执行完成后持久化工具结果事件，再进入下一次模型流；最终 assistant 文本完成后保存完整展示消息。
- 事务提交成功后发送 `done`。
- 模型调用失败、工具调用参数不完整、工具执行失败、事务开始前观察到客户端取消、流异常或事务失败时，不保存本轮半成品展示消息；已提交的内部事件按聊天记录契约保留。
- 事务开始后断连可能与事务提交竞速；提交成功但 `done` 未送达时，前端状态为未知，通过 `start.conversationId` 重新读取详情核实，禁止自动重发。
- 新会话在流运行前创建；客户端取消时删除该会话及其 trace。模型或工具失败时保留会话和已提交 trace，但不保存半成品展示消息。
- 已有会话继续使用当前用户归属校验和上下文压缩规则。

## 前端行为契约

- 页面初始化请求 `GET /api/chat/conversations`。
- 选择会话请求 `GET /api/chat/conversations/:id`，并按消息时间顺序展示。
- 发送时立即展示 user 消息和 assistant 临时占位。
- 收到 `delta` 时追加 assistant 内容。
- 收到 `done` 时写入服务端返回的会话 ID、标题和用量，并更新侧栏。
- 收到 `error`、HTTP 错误或连接异常时保留已收到文本，标记本轮未完成并展示错误状态。
- 切换聊天记录、新建聊天和站内路由切换不取消生成；应用级任务继续读取原会话的 SSE，页面卸载仅清理页面订阅和局部状态。
- 每个会话独立维护生成状态和临时消息；侧栏在对应会话上显示加载状态，切回时恢复已有增量，不重复发起生成请求。
- 同一会话生成及完成后刷新期间禁止重复发送和删除；不同会话允许分别生成，后台结果只能更新所属会话。
- 用户主动停止、退出登录、认证身份变化或应用销毁时通过 `AbortController` 取消对应请求并清理资源。未收到 `done` 的主动停止和真实断流仍保留待核实语义。
- 后台继续只覆盖同一浏览器文档内的路由和会话切换；刷新、关闭标签页及网络断开不提供服务端续跑或断线续传保证。
- 未完成的 assistant 文本只保留作临时提示，不进入后续请求历史或正式缓存。
- 已取消请求的迟到响应不得修改任何会话；正常运行的任务仅更新所属会话缓存，不能覆盖用户当前打开的其他会话。
- Axios 调用方显式传入当前访问令牌；API 层沿用现有 401 Refresh Token 单飞重试逻辑。
- 接口 UUID 和 ISO 8601 时间在 API/页面边界显式映射为视图模型类型。

## 权限与兼容性

- 不改变现有普通用户和管理员会话接口的权限边界。
- 普通用户只能继续自己的会话；不存在或越权统一返回 `404`。
- 不新增 Entity、Migration、Guard 或 Decorator；前端通过 Pinia Store 持有跨路由的聊天任务，既有 HTTP/SSE 协议和后端行为保持不变。
- 流式接口由 `ChatRecordsModule` 负责会话和展示投影，由 `LlmModule` Graph 负责模型流、工具节点和内部事件节点。
- 流式 API 契约的规范位置为 `docs/contracts/chat-streaming-crud-contract.md`；业务目录设计、技术和实施文档通过相对链接关联该契约。

## 验收清单

- [ ] 事件名称、数据结构和顺序符合本契约；普通文本和带工具调用的流均收到 `start`、可选多个 `delta` 和 `done`。
- [x] `done` 只在事务保存成功后发送；单元测试覆盖事务提交失败不发送 `done`。
- [ ] 新会话取消时删除会话及其 trace，不保存半轮展示消息。
- [ ] 前端 Axios 流式读取、历史加载和会话侧栏更新正常；已完成前端实现、类型检查和构建，浏览器端交互及 Axios 401 刷新联调待验证。
- [x] 响应开始前的 HTTP 错误兼容现有行为；Controller 保持响应头发送前重新抛出 HTTP 异常。
- [ ] 新增内部 trace 迁移后，原聊天记录接口保持原路由。
- [x] `/api/docs-json` 包含新增流式路由、`text/event-stream` 成功响应及已声明的 HTTP 错误响应。
