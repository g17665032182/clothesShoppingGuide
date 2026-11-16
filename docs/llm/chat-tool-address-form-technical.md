# 对话地址管理界面请求技术文档

## 状态与范围

- 状态：技术方案已确认并完成代码实施；自动化测试和登录态浏览器验收暂缓。
- 日期：2026-11-16。
- 设计依据：[对话地址管理界面请求设计](./chat-tool-address-form-design.md)。
- 行为契约：[聊天地址管理界面请求 CRUD 契约](../contracts/chat-tool-address-form-crud-contract.md)。
- 领域契约：[收货地址 CRUD 契约](../contracts/user-address-crud-contract.md)。

本方案只新增 SSE 聊天流中的一次性页面导航请求。地址读取、校验和写入继续由认证地址管理页及既有 `user-addresses` API 负责。JSON 聊天不注册该工具；本功能不新增 HTTP API、数据库资源、迁移、依赖或地址读写权限。

## 本地实现依据

| 现有实现                                                                   | 本次复用方式                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/api/src/chat-records/tools/request-preference-form.tool.ts`          | 复用 LangChain 工具工厂、严格 Zod 对象和固定结果结构；地址工具 schema 收窄为空对象           |
| `apps/api/src/chat-records/service/chat-records.service.ts`                | 在 `PreparedChat` 中维护本轮 pending/已发送状态；仅在 SSE 工具集中注册并于流迭代边界发出事件 |
| `apps/api/src/chat-records/controller/llm-chat.controller.ts`              | 继续按 `ChatStreamEvent.type` 编码 SSE，不新增 Controller 路由                               |
| `apps/web/src/api/modules/chat.ts`、`apps/web/src/api/types/chat.ts`       | 在事件名白名单、严格 payload 解析和联合类型中加入 `address-form`                             |
| `apps/web/src/stores/chat/index.ts`、`apps/web/src/stores/chat/session.ts` | 将一次性请求绑定到生成事件的本地会话、当前账号身份和运行时 request id                        |
| `apps/web/src/pages/chat/page.ts`                                          | 复用页面内消费请求、会话校验、命名路由导航和 Sonner Toast 模式                               |
| `apps/web/src/router/index.ts`                                             | 复用现有受认证保护的 `account-addresses` 命名路由                                            |
| `apps/api/src/chat-records/history/chat-history.mapper.ts`                 | 复用内部 UI 请求工具的调用与结果成对隐藏方式                                                 |
| `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`             | 为地址工具增加独立的参数、结果和嵌套调用白名单投影                                           |
| `apps/api/src/chat-records/display/chat-display.service.ts`                | 保持现有通用工具 activity 投影：只公开工具名和状态，输入、输出均为 `null`                    |

无需增加运行时依赖或通用事件框架。聊天编排不导入地址 Entity、Repository、完整地址 DTO 或地址读取服务。

## 文件职责与模块边界

本次实施由以下位置承载变更：

| 文件                                                                       | 职责                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------- |
| `apps/api/src/chat-records/tools/request-address-form.tool.ts`             | 定义严格空对象 schema 和固定安全工具结果              |
| `apps/api/src/chat-records/service/chat-records.service.ts`                | SSE 工具注册、pending 状态、事件消费与发射            |
| `apps/api/src/chat-records/history/chat-history.mapper.ts`                 | 历史恢复时隐藏内部工具调用及其结果                    |
| `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`             | trace 参数、结果、嵌套模型调用的白名单投影            |
| `apps/api/src/chat-records/spec/`                                          | 后续授权测试时覆盖工具、流事件、历史隐藏和 trace 脱敏 |
| `apps/web/src/api/types/chat.ts`                                           | 声明 `address-form` 事件分支                          |
| `apps/web/src/api/modules/chat.ts`                                         | SSE 名称白名单及空对象 payload 严格校验               |
| `apps/web/src/stores/chat/session.ts`、`apps/web/src/stores/chat/index.ts` | 会话级导航请求状态、身份校验、消费与重置              |
| `apps/web/src/pages/chat/page.ts`                                          | 请求消费时固定导航至 `account-addresses` 并显示 Toast |

不得修改 `user-addresses` 的领域 schema、Entity、Repository、Controller、地址 API、地址管理表单或订单地址快照语义。最终实施拆分和文件所有权须在技术方案获批后写入实施文档。

## 工具 Schema 与结果

新增工具 `request_address_form`，使用 `@langchain/core/tools` 和已安装的 `zod`：

```ts
export const requestAddressFormSchema = z.strictObject({});
```

- 仅 `{}` 合法；未知字段、`null`、数组、字符串、数字和嵌套对象均拒绝。
- Schema 不含用户、会话、地址、URL、路由或请求键字段。
- 该工具不经过 HTTP Controller、Nest 参数管道或 Swagger DTO。
- 工具说明仅在用户明确要求管理本人地址时适用，不把一般地址咨询解释为导航请求。
- 输入校验成功后，回调仅设置当前 `PreparedChat` 的一次性 pending 标记，不执行异步领域操作。
- 工具结果固定为 `{ "ok": true, "code": "requested" }`；运行上下文不可用时为 `{ "ok": false, "code": "unavailable" }`。不返回地址内容、标识、URL、异常原文或自由文本。
- `requested` 仅代表服务端接受了导航意图，不表示浏览器已成功切换页面。

## SSE 注册、状态和发射

`PreparedChat` 增加本轮运行状态：

```ts
pendingAddressFormRequest: boolean;
addressFormEventSent: boolean;
```

两项在 `prepareChat()` 为 `false`。工具工厂只接收设置 pending 标记的回调，不读取会话、用户或地址资料。

- 只在现有 SSE 工具集分支注册；JSON `chat()` 使用的默认工具集不包含 `request_address_form`。
- 第一次有效调用置 pending；后续调用以及已发射后的调用不覆盖、不重复排队。
- 在现有 `purchase-form` / `preference-form` 流式事件消费边界取出 pending 标记，标记已发送并返回 `{ type: 'address-form' }`。
- 当试穿同步回退分支完成模型调用时，也在输出最终 assistant 文本前消费该事件，沿用现有 UI 请求事件时序。
- Controller 通过通用 SSE 编码发送事件名 `address-form`，数据为空对象 `{}`。
- 事件只存在于当前服务端运行；不放入 `ChatDisplayData`、assistant 正文、展示 envelope、长期记忆或数据库字段。

## Web 事件解析和会话消费

### API 协议

`ChatStreamEvent` 增加 `{ type: 'address-form' }`。`parseEventFrame()` 将 `address-form` 加入固定事件名白名单，并且只接受 JSON 对象且无键：

```json
{}
```

未知键、非对象、`null`、非法 JSON 或畸形 payload 均不得产生可执行导航事件。解析器不接受客户端/模型提供的目标路径。

### 一次性请求状态

Store 收到 SSE 事件时，只有在聊天页仍可见、事件对应任务仍有效、当前会话仍为活动会话且存在已认证用户时，才把请求放入该 `ChatSession`。状态只包含本地 `requestId`、用户 ID 和身份版本，不含地址数据；它不进入持久化存储。

消费前后检查：

- request id 仍是该会话的当前待处理请求；
- 活动会话仍等于发起事件的会话；
- `identityVersion` 与事件到达时一致，当前用户 ID 未变化；
- 聊天页仍在有效生命周期，目标会话未删除或替换。

处理前以 request id 去重并标记 in-flight。成功、失败、取消或丢弃后清除 pending 状态。账号重置、会话切换、页面离开和生成任务清理均不得在之后恢复旧请求；状态不跨刷新或应用重启。

### 固定导航与反馈

导航只使用现有命名路由：

```ts
await router.push({ name: 'account-addresses' });
```

不得拼接 URL 或使用模型参数生成路由。只有未被取消且最终路由名确为 `account-addresses` 时，客户端才显示固定成功 Toast；导航失败或被重定向时显示固定失败 Toast。若用户已切换身份、会话或离开聊天页，则安全丢弃，不对新身份导航。路由守卫继续负责认证检查，本工具不绕过认证。

客户端导航结果不回传给模型，不追加聊天消息，不写历史或 trace；地址页加载错误仍由地址页现有状态处理。

## 历史、trace 与 activity 脱敏

- 将 `request_address_form` 加入内部 UI 请求工具隐藏名单；恢复历史时，模型响应中的正常、非法或嵌套调用以及对应/孤立结果都不重放给模型。
- Trace 对调用参数使用专属投影：不论原始模型参数为何，持久化参数只能是空对象 `{}`。
- Trace 对工具结果只允许 `ok` 布尔值和 `requested` / `unavailable` 固定代码；不能保留错误字符串、地址字段、用户/会话标识或 URL。独立调用与嵌套于 model response 的调用均须经过同样投影。
- SSE activity 沿用通用安全投影，仅保留固定工具名和执行状态，`input`、`output` 为 `null`。内部导航事件及路由结果不作为 activity payload。
- 工具结果和事件不得进入长期记忆、公开展示 envelope 的地址数据字段、日志自由文本或跨会话状态。

## 错误与兼容行为

| 情况                                   | 处理                                               |
| -------------------------------------- | -------------------------------------------------- |
| 严格空对象输入                         | 设置一次性 pending 请求并返回固定 `requested` 结果 |
| 未知参数或非对象输入                   | 工具 schema 拒绝；不设置 pending、不发事件         |
| 非 SSE/JSON 聊天                       | 不注册此 UI 工具，既有工具行为保持不变             |
| SSE 事件格式错误或存在未知键           | Web 丢弃/拒绝事件，不执行导航                      |
| 同轮重复工具调用                       | 只发送第一次有效事件                               |
| 会话切换、账号切换、页面离开或会话删除 | 清除或丢弃旧请求，不在新上下文恢复                 |
| 登录失效                               | 由现有认证路由守卫处理，不请求匿名地址 API         |
| 导航失败或被取消                       | 固定失败 Toast；不伪称成功，不触发地址 CRUD        |
| 地址页面加载失败                       | 保持地址页面原有错误行为                           |

本功能不改变旧消息正文兼容、不改变地址 CRUD / 幂等 / 删除 / 默认地址规则，也不新增依赖、配置、HTTP 路由、Entity、Migration、Seeder 或数据库表。

## 测试与验证方案

实施阶段建议覆盖：

- 后端工具 schema 对 `{}` 的接受，以及未知字段、`null`、数组和标量的拒绝。
- SSE 工具集中存在、JSON 工具集中不存在；多次调用仅发一个空 payload 事件。
- SSE 编码事件名和 payload 白名单；事件不进入 display envelope。
- 历史 mapper 隐藏合法、非法、嵌套及孤立调用结果。
- Trace 调用、结果、失败结果及嵌套模型响应只保留白名单字段。
- Web parser 接受空对象，拒绝非对象、未知键和错误 JSON。
- Store 对重复事件、切换会话/账号、页面卸载和会话删除的去重与丢弃行为。
- 页面只推送 `account-addresses`，按真实路由结果提示，不触发地址 API。
- 确认没有新增 HTTP 路由、数据库迁移和地址数据写入。

用户此前要求暂不执行测试。本次实施未运行自动化测试、真实模型调用或登录态浏览器验收；API/Web 类型检查、API/Web 构建、Prettier 检查和 `git diff --check` 已由主代理完成。

## 决策记录

- 2026-11-16：用户确认设计文档和 CRUD 契约；进入技术方案阶段。
- 已确认决策：工具名 `request_address_form`；严格空对象输入；仅 SSE 注册；固定导航至 `account-addresses`；每轮首次有效请求生效；客户端按真实导航结果 Toast；不读取、回显、写入或持久化地址数据。
- 2026-11-16：用户确认技术方案，并授权直接完成实施文档后按实施文档实施。实施分工、文件所有权及暂缓测试约定见[实施文档](./chat-tool-address-form-implementation.md)。
