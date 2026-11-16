# 对话偏好管理页面请求技术文档

## 状态与范围

- 状态：已确认；已实施。
- 日期：2026-11-16。
- 设计依据：[对话偏好编辑界面请求设计](./chat-tool-preference-form-design.md)。
- 行为契约：[聊天偏好编辑界面请求契约](../contracts/chat-tool-preference-form-crud-contract.md)。
- 领域契约：[用户偏好 CRUD 契约](../contracts/user-preferences-crud-contract.md)。

本技术方案新增 `request_preference_form` 工具，让模型请求当前聊天用户打开既有偏好管理页面。偏好值的读取、编辑、提交和开关继续归现有偏好页面与认证 CRUD API；本功能不新增数据资源、HTTP API、数据库变更或动态表单。

首版只在 SSE 工具集中注册该 UI 请求工具。现有 JSON 聊天端点没有一次性 UI 导航事件通道；不能把工具结果 `requested` 当作浏览器已导航，也不能将导航信号写入持久化展示 envelope 来模拟运行时事件。若要求 JSON 聊天也触发导航，需要另行设计响应协议并重新确认范围。

## 本地实现依据

| 现有实现                                                                                                                | 本次复用方式                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/api/src/chat-records/service/chat-records.service.ts` 的 `tools()`、`PreparedChat` 与 `takePurchaseFormRequest()` | 每轮服务端绑定工具、待发一次性请求标记和 SSE 事件时机                    |
| `apps/api/src/chat-purchase/tool/request-purchase-form.tool.ts`                                                         | 无参数的 UI 请求工具模式；新工具改为严格可选类别参数，不复用购买草稿业务 |
| `apps/web/src/api/modules/chat.ts`、`apps/web/src/api/types/chat.ts`                                                    | SSE 事件名白名单、payload 解析和联合类型                                 |
| `apps/web/src/stores/chat/index.ts`、`apps/web/src/stores/chat/session.ts`、`apps/web/src/stores/chat/turn.ts`          | 将运行时导航请求绑定到发起该轮的本地会话，并在会话结束后消费             |
| `apps/web/src/router/index.ts`                                                                                          | 复用受认证保护的 `account-memories` 路由                                 |
| `apps/web/src/pages/memories/page.ts`、`use-preferences.ts`                                                             | 复用 `view=preferences` 页面和现有类别列表筛选；补充 URL 类别预选        |

工具使用已安装的 `@langchain/core/tools` 和 `zod`；SSE 解析继续使用现有手写白名单校验模式。无需增加运行时依赖或新的通用事件框架。

## 模块所有权与依赖方向

| 所属位置                      | 职责                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- |
| `chat-records`                | 工具创建、SSE 一次性事件发射；不查询或写入偏好                          |
| `apps/web/src/api`            | 解析固定事件名及可选类别                                                |
| `apps/web/src/stores/chat`    | 绑定发起事件的会话、去重、消费和清理运行时请求                          |
| `apps/web/src/pages/chat`     | 仅在仍处于事件所属活动会话时执行固定路由导航，并显示固定成功/失败 toast |
| `apps/web/src/pages/memories` | 验证 URL 上的类别并驱动现有类别筛选                                     |
| `user-preferences`            | 保持现有偏好领域、CRUD 与权限，不增加本功能专属 API                     |

聊天模块不得导入偏好 Entity、Repository、私有 DTO 或偏好值 schema。前端 API 层不得解释模型自然语言或聊天历史中的 JSON 作为导航命令。

## 工具接口与 Schema

新增 `apps/api/src/chat-records/tools/request-preference-form.tool.ts`，导出工具工厂；由 `ChatRecordsService.tools()` 注入当前 `PreparedChat` 的回调。工具工厂不接收 `userId`、`conversationId`、URL 或偏好 reader。

```ts
const preferenceFormCategorySchema = z.enum([
  'size',
  'shoe_size',
  'fit',
  'style',
  'color',
  'occasion',
  'budget',
  'avoidance',
  'purchase_preference',
]);

const requestPreferenceFormSchema = z.strictObject({
  category: preferenceFormCategorySchema.optional(),
});
```

- 输入类型从 schema 派生；schema 解析后的输入和外部模型输入不手工重复定义。
- `{}` 合法；`category` 只能是九类之一。
- 拒绝额外字段、`null`、非法类别、身份/会话/资源标识和 URL。
- 本工具不经过 HTTP Controller 或 Nest 参数 Pipe；模型工具输入由 LangChain 工具 schema 在执行前校验。
- 非法工具输入不得把原始参数或解析异常放入工具结果、SSE activity 或日志。

工具输入通过校验后，在第一次异步操作前调用 `onRequested(category?)`，然后返回固定安全结果，例如 `{ "ok": true, "requested": true }`。结果可带回已校验类别，但不得包含偏好值、偏好 ID、用户 ID、会话 ID、URL 或自由文本。当前工具不做权限外的业务调用；认证聊天上下文由既有聊天流程保障。若回调或工具执行异常，返回 `{ "ok": false, "code": "unavailable" }`。

工具描述应限制在“用户明确要求管理或修改本人穿衣偏好”的场景，不得把浏览商品、询问穿搭建议或查询偏好本身自动解释为打开管理页的请求；模型不得把 `requested` 表述为导航已成功。

## SSE 事件和状态生命周期

### 事件契约

新增 API 运行时事件 `preference-form`：

```ts
{ type: 'preference-form'; category?: PreferenceCategory }
```

- 服务端只在 SSE 的 `tools(prepared, display, true)` 工具集中加入该工具；普通 JSON 工具集不注册。
- `PreparedChat` 增加本轮 pending 类别和已发标记。只在首次有效请求时记录类别并发出一个事件；同轮后续调用不重复发射。
- 事件在工具执行产生待发标记后的流式迭代边界发出，复用 `purchase-form` 的现有时机，不等待整轮模型结束。
- 同轮多次请求只消费第一个有效请求及其类别，避免多个导航互相覆盖。
- 事件只在当前运行内存中存在；不加入 `ChatDisplayData`、`ChatDisplayEvent`、展示 envelope、消息正文或数据库。
- 工具成功结果的含义是“已接受本轮导航请求”，并不表示客户端已完成导航。当前 SSE 协议不从前端回传路由结果给模型。

后端修改仅涉及聊天服务运行时类型、待发状态、工具注册和 SSE 发射，不触碰 `ChatDisplayService` 展示投影。由于没有新的持久化字段或路由，本功能不需要 migration、Entity、CRUD DTO、Swagger DTO 或 Nest 注入 token。

### Web 解析与消费

1. 在 `ChatStreamEvent` 增加事件联合分支，并在 `parseEventFrame()` 事件白名单中加入 `preference-form`。
2. 仅当 payload 是严格对象且 `category` 缺省或属于九类枚举时接受；拒绝未知键、非法类别、错误类型及不合法 JSON。空对象可代表无类别导航。
3. Store 收到事件时将请求放入与当前生成任务对应的 `ChatSession`，而不是全局 store 标记。仅将安全枚举类别和本地一次性 request id 保存在运行时状态中。
4. 聊天页消费请求前再次确认发起任务对应的会话仍是活动会话，当前登录用户身份未变化，且会话未被替换或删除。若事件到达时用户已切换会话/账号、页面已离开或该会话不再有效，丢弃请求，不在之后恢复旧导航。
5. 消费前即标记 request id 已处理，避免 Vue watch 重跑导致重复 `router.push`。每次请求完成或被丢弃后清除会话内 pending 状态；不得跨刷新、应用重启或会话切换持久化。
6. 用命名路由固定导航，不采用模型提供的地址：

```ts
await router.push({
  name: 'account-memories',
  query: {
    view: 'preferences',
    ...(category ? { category } : {}),
  },
});
```

7. `router.push` 成功且目标路由确为偏好管理视图后显示固定成功 toast；抛错、被取消或身份/会话检查失败显示固定失败 toast 或静默丢弃（若用户已离开/切换身份）。不得追加声称成功的聊天消息，也不将失败回传给模型。
8. 路由要求认证。若用户认证状态在事件和导航之间失效，既有路由守卫负责转至登录页；前端不绕过守卫、不尝试匿名偏好请求。

成功/失败 toast 属于客户端导航结果反馈，不属于聊天历史。初版由于路由导航离开聊天页后无法保证反馈呈现在原聊天 transcript 内，反馈使用现有 toast 机制；不得伪造已持久化 assistant 消息。

## 页面 Query 预选

目标页面已有 `view=document` 与默认 `preferences` 的区分，以及 `usePreferences()` 中的 `selectedCategory` 筛选状态。本次只增加 category query 的输入校验和同步，不改变数据查询、编辑器或保存 API。

- `apps/web/src/api/types/preferences.ts` 已有 `PreferenceCategory` 联合类型；`preference-display.ts` 已有允许类别列表。页面 query 校验应复用该类别来源，不另造不一致的枚举。
- `page.ts` 从 route query 解析类别：仅接受单个合法字符串；缺失、重复值、数组或非法值不作为类别筛选。
- route 为 `view=document` 时忽略 category，不改变记忆文档行为。
- 在偏好视图激活及 query 变化时，将合法 category 同步到 `selectedCategory`；缺失或非法值重置为“全部类别”。由此用户可以通过已有 `changeCategory()` 主动更改筛选。
- 用户在下拉框手动更改类别时，更新 route query 的 category（全部类别时移除），使用 `router.replace` 避免每次筛选都堆积浏览历史；保持当前 `view=preferences`。
- query 只筛选列表，不自动打开创建/编辑器，不预填任何已有值，不改变偏好开关。
- 非法或重复 query 应规范化为无筛选状态，并移除无效 `category` 参数，避免地址栏保留无效状态。
- 视图切换和 KeepAlive 生命周期必须保持当前合法 query 与组件状态一致；路由返回/前进时页面状态以 route query 为准。

合法路由示例：`/account/memories?view=preferences&category=shoe_size`。未知 query 不得被解释为导航指令或传入偏好 API。

## 持久化、历史与隐私边界

- `request_preference_form` 只作为内部动作工具；新增工具名到 `chat-history.mapper.ts` 的隐藏工具白名单，使历史恢复时调用和结果成对隐藏。
- `chat-trace-writer.service.ts` 对该工具使用专属白名单投影：仅保存固定工具名、合法类别（若存在）和固定状态码；不保存自由文本、异常、身份字段或任意参数。若现有 LLM trace 在写入前保留原始模型 tool args，必须在持久化边界对该工具名做脱敏，而不改变当前运行时工具输入。
- SSE activity 的输入/输出沿用现有工具 activity 安全投影，不展示模型原始输入或工具结果。仅允许固定展示名和状态。
- 一次性 `preference-form` 事件、前端 pending request id、路由结果和 toast 均不得写入公开展示 envelope、聊天消息、记忆来源或跨会话存储。
- 类别只是低敏有限枚举，但仍应按白名单投影；不得把偏好值或页面表单值塞入事件。
- 任何实现不得调用偏好读取、写入、设置或长期记忆 API。既有偏好开关及手动 CRUD 可用性不变。

## 错误与兼容行为

| 情况                                   | 处理                                             |
| -------------------------------------- | ------------------------------------------------ |
| 工具参数非法或含未知字段               | schema 拒绝；不设置 pending 状态、不发事件       |
| 缺少类别                               | 导航至默认偏好列表，不猜测筛选                   |
| SSE payload 未知键、非法类别或格式损坏 | Web 丢弃事件，不执行导航                         |
| 同一轮重复请求                         | 仅发出/处理第一次有效请求                        |
| 用户切换会话、账号或目标会话失效       | 丢弃 pending 请求，不在后续会话恢复              |
| `router.push` 失败或导航被取消         | 固定失败 toast；不伪报成功、不调用 CRUD          |
| 当前认证失效                           | 交由现有路由守卫处理，不绕过认证                 |
| JSON 聊天请求                          | 不注册导航工具；保持 JSON 响应及现有工具行为不变 |
| 关闭偏好读取开关                       | 不影响进入手动偏好管理页；不读取或写入偏好开关   |

## 测试与验收

### 后端

- 工具 schema 接受空对象及九种合法类别；拒绝非法类别、`null` 和额外字段。
- 工具只在 SSE 工具集中出现；JSON 工具集中不存在 `request_preference_form`。
- `onRequested` 在任何异步工作前执行；执行失败返回固定 unavailable，不输出异常。
- 同轮重复调用只发一个事件，保留首次有效类别。
- SSE 事件名和 payload 仅包含允许键；一次性事件不进入 display envelope。
- 历史 mapper 隐藏该工具的调用和结果；trace 对独立调用、结果及嵌套模型调用做允许字段投影。

### 前端

- SSE parser 接受缺省/合法 category，拒绝额外字段、非法 category 和错误 payload。
- 请求只绑定到生成该事件的会话；切换会话、账号、删除会话及页面卸载后不发生陈旧导航。
- 重复消费同一 request id 不重复 push；导航失败不留下 pending 状态。
- 固定目标为 `account-memories`，无类别移除 category；合法类别作为筛选 query。
- 九类 query 均可预选；非法、重复和数组 query 不筛选且被规范化移除。
- 偏好类别筛选变化可用浏览器前进/后退恢复；不打开编辑器或预填记录。
- 偏好视图切换、记忆文档视图和认证守卫行为保持原样。

### 持久化与回归

- 检查数据库 schema、migration 目录无本功能变更。
- 检查聊天消息正文、公开展示 envelope、记忆来源及 trace 投影不含类别以外的表单/偏好信息。
- 回归 `request_purchase_form`、动态表单、已有 category 过滤和偏好 CRUD。

建议在实施阶段运行：

```text
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web build
git diff --check
```

以上为实施阶段的验证命令。本阶段实际结果以[实施记录](./chat-tool-preference-form-implementation.md)和[项目全量验证计划](../testing/project-full-validation-plan.md)为准；浏览器认证 Smoke Test、真实 LLM/图像供应商和未开启的历史数据库门控仍明确列为未执行。

## 决策记录

- 2026-11-16：设计文档与 CRUD 契约经用户确认后进入技术文档阶段；用户已确认本技术方案。技术取舍为 SSE-only 一次性导航事件、JSON 聊天不注册工具、客户端以 Toast 反馈实际路由结果。
- 2026-11-16：基于现有购买 UI 请求模式，首版使用 SSE 一次性导航事件。JSON 端点目前没有同类 UI 信号通道，因此不注册此 UI 工具；如需 JSON 支持，作为后续协议扩展重新确认。
- 2026-11-16：设计、契约、技术方案和实施文档均已确认；功能已按 SSE-only 范围实施并完成自动化验证。
