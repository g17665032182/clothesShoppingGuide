# 聊天试穿工具技术文档

## 状态与关联

- 状态：用户已于 2026-11-12 确认技术方案；设计与工具契约亦已确认。
- 设计：[聊天试穿工具设计](./chat-try-on-design.md)。
- 契约：[聊天试穿工具契约](../../contracts/chat-try-on-tool-contract.md)。
- 复用契约：[AI 虚拟试穿 CRUD 契约](../../contracts/virtual-try-on-crud-contract.md)。
- 所属模块：`apps/web` 的商品卡及聊天展示；`chat-records` 的动作编排与模型上下文；`virtual-try-on` 的照片、任务、额度、图像处理和私有结果；`product-catalog` 的商品资格端口。
- 最后更新：2026-11-12。

本文只定义技术方案，该方案已于 2026-11-12 确认；实现按已单独审批的实施文档推进。

## 方案摘要

点击商品卡上的试穿操作是明确的用户动作，不交给模型从自然语言中推测。前端先完成商品颜色、本人照片选择和图像处理同意，然后通过现有聊天 SSE 请求提交一个严格校验的 `tryOnAction`。`ChatRecordsService` 据此直接调用 LangChain 试穿工具一次，再把成功生成图作为本轮专用的多模态模型输入。模型只生成文字答复；聊天响应同时带上不含图片地址的结果任务引用，前端使用现有本人任务下载接口取图并渲染。

生图继续复用 `virtual-try-on` 的后台任务、活动任务约束、成功额度、图像供应商适配器和私有对象存储。聊天工具等待任务终态以完成同一轮“工具 -> 生图 -> 聊天模型”链路；如果客户端断开或等待超时，后台任务继续完成，结果仍可从“我的试穿”读取。

## 仓库调查与依赖

- API 已安装 `@langchain/core`、`@langchain/langgraph`、`@langchain/openai` 和 Zod；`ChatRecordsService` 装配工具，LangGraph 负责普通模型工具调用。
- `virtual-try-on` 已有 `ProductCatalogTryOnPort`、`TryOnTaskService`、`TryOnImageProvider`、图片规范化、私有对象存储和任务结果下载。图像供应商适配器已接收本人图片与商品图并返回经过签名检测的图片 `Buffer`。
- 商品卡当前把用户导航到“我的试穿”；该页已有颜色选择（默认当前首个有效颜色）、本人照片选择、明确同意、上传和结果下载交互，可复用这些业务组件和 API 适配器，将提交动作改为聊天动作。
- 不新增模型 SDK、图像供应商、通用任务框架或前端测试依赖。跨模块依赖通过 `virtual-try-on` 公开 Port，不从聊天模块读取试穿 Entity、Repository 或私有对象键。
- LangChain.js 消息文档区分发给模型的 `content` 与不作为模型输入的 `artifact`；多模态消息使用图片内容块。实现中用 artifact 在服务端短暂持有图片字节，再显式组装本轮模型图片输入，不把图片字节序列化为工具文本。上游 OpenAI-compatible 服务对图片输入的支持仍须用配置中的实际模型和合成图做集成验证。

## 模块与文件职责

### Web

| 路径                                                                     | 职责                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/pages/chat/components/ChatProductResults.vue`              | 保留仅对合格服装显示的试穿入口；点击后打开预提交状态，不再跳转至“我的试穿”。                                 |
| `apps/web/src/pages/chat/components/`                                    | 选择颜色、本人已保存照片或上传临时照片、展示同意文案并要求主动勾选；没有有效照片/同意/可用性时不得提交动作。 |
| `apps/web/src/api/modules/chat.ts`、`apps/web/src/api/types/chat.ts`     | 给聊天请求增加严格类型的可选 `tryOnAction`；不将照片内容放进消息文本。                                       |
| `apps/web/src/stores/chat/`                                              | 将 `tryOnAction` 纳入当前流式请求，并把安全结果附件合并到本轮消息及历史消息。                                |
| `apps/web/src/api/modules/try-on.ts`、`apps/web/src/api/types/try-on.ts` | 复用现有照片上传/列表和任务结果下载接口。                                                                    |
| `apps/web/src/pages/chat/components/`                                    | 注册固定的试穿结果附件视图；由任务 ID 调用本人任务读取/下载接口，处理加载、过期、已删除和无权访问。          |

交互需展示选择、上传、同意、提交中、生图中、完成和失败状态。生成结果只供视觉参考。用户未登录时沿用现有路由认证行为；已禁用真实人像处理的环境不能通过前端绕过服务端 `availability`。

### API

| 路径                                                                                      | 职责                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/llm/dto/chat.dto.ts`                                                        | 在聊天输入 Zod schema 中定义严格的 `tryOnAction` 联合分支。                                                  |
| `apps/api/src/chat-records/service/chat-records.service.ts`                               | 读取认证用户和动作上下文，按动作直接调用试穿工具，连接安全结果与聊天显示附件；普通聊天保持现有模型工具行为。 |
| `apps/api/src/chat-records/try-on/`                                                       | 放置聊天专属 LangChain 工具、运行上下文和安全结果投影；不复制试穿领域规则。                                  |
| `apps/api/src/virtual-try-on/port/`、`service/`、`virtual-try-on.module.ts`               | 提供聊天可调用的公开 Port；在试穿模块内创建/等待任务并读取本人私有结果字节。                                 |
| `apps/api/src/chat-records/display/`                                                      | 为结果附件添加严格投影、助手消息绑定、实时事件和历史恢复；图片引用只保存本人任务 ID 与安全摘要。             |
| `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`、`apps/api/src/llm/graph/` | 记录安全动作摘要，并确保临时多模态消息和图像字节不进入 trace、活动或公开历史。                               |
| `apps/api/src/chat-records/spec/`、`apps/api/src/virtual-try-on/spec/`                    | 覆盖工具、任务适配、聊天编排、trace 隔离、结果投影和 API 行为。                                              |

依赖方向为 `chat-records -> virtual-try-on` 的导出 Port；`virtual-try-on -> product-catalog` 继续通过目录 Port。不得让 `product-catalog` 依赖聊天模块。

## HTTP 输入与校验

现有聊天 Body 增加一个可选的严格动作对象；普通聊天请求形状保持兼容：

```ts
const tryOnActionSchema = z.strictObject({
  productExternalId: boundedProductExternalId,
  color: boundedColor,
  photoId: z.uuid(),
  consentVersion: z.string().trim().min(1).max(80),
});
```

- 字段类型从 Zod schema 推导；聊天 Controller 仍经现有 `StandardSchemaValidationPipe` 绑定。
- `tryOnAction` 出现在 `/api/llm/chat/stream` 的 JSON Body，不进入 `messages[].content`。用户在聊天中的可见文本由前端按现有聊天行为提交。
- `productExternalId` 和 `photoId` 是工具的唯一业务参数。`color` 与 `consentVersion` 留在当前 HTTP 动作上下文，由工具闭包/受控 Port 参数传递；工具调用参数不接受 `userId`。
- 认证用户只从 `@CurrentUser()` 获取。不能从 action、模型参数、聊天历史或 SSE query string 读取身份。
- 服务端重新校验当前商品、颜色、照片归属/状态、同意版本、额度和活动任务。客户端传入的商品卡快照只用于展示，不作为准入依据。
- 生产真实人像仍由现有 `TRY_ON_REAL_PHOTOS_ENABLED` 闸门和照片服务的 `availability` 控制；供应商审查未完成时生产配置保持关闭。
- 没有 `tryOnAction` 的旧请求不改变行为。若同一请求同时携带非法动作字段或未知字段，返回现有统一 Zod 400 错误。

工具输入仍为：

```ts
z.strictObject({
  productExternalId: boundedProductExternalId,
  photoId: z.uuid(),
});
```

前端点击操作必须确定性触发该工具，不通过“把按钮点击改写成提示词并等待模型自行决定”实现。`ChatRecordsService` 使用通过校验的动作组装本轮 LangChain `tool()` 实例并调用一次；工具内部委托 `virtual-try-on` Port。普通聊天不因本增量默认暴露此工具。工具使用 `content_and_artifact` 响应格式，使安全文本和仅供服务端编排的图片字节分离。

点击动作由服务端触发，工具调用与最终模型回答是同一聊天 run 的前置步骤。聊天记录服务先将真实用户输入、服务端发起的工具调用和安全工具结果按连续序号写入 trace，再把下一个 trace 序号交给 LangGraph，并标记本轮输入 trace 已写入；LangGraph 从该序号继续且跳过重复的 `persistInput` 写入。这样避免事件序号冲突或重复记录用户输入。历史 mapper 将该工具事件恢复为普通 LangChain 工具消息，不恢复图片 artifact。

## 生成任务与图片交接

1. `ChatRecordsService` 按动作创建试穿工具运行上下文，固定绑定认证 `userId`、颜色和经 Zod 校验的同意版本。调用参数与闭包上下文不一致时拒绝，不重试到其他商品或照片。
2. 工具调用 `virtual-try-on` 的聊天 Port。Port 在试穿模块内调用现有任务创建规则，复用当前目录准入、照片拥有权、同意版本、单活动任务、每日成功额度和商品颜色图片选择。
3. 任务仍由现有 worker 和 `TRY_ON_IMAGE_PROVIDER` 处理；不在聊天工具中直接调用供应商，不复制重试或图片处理逻辑。工具在同一聊天请求内轮询本人任务状态至 `succeeded`、`failed` 或有界等待超时。
4. 任务成功后，试穿模块再次验证任务/结果均归属于当前用户，再从私有对象存储读取结果字节。Port 只把 `Buffer`、受检 MIME、尺寸和任务摘要返回聊天模块；对象键、签名 URL、供应商响应和源照片字节不越过模块边界。
5. 试穿工具的公开文本结果只含有限状态和必要任务摘要；图像字节保存在 LangChain 工具的服务端 artifact/内部返回值，不序列化到 `ToolMessage.content`。
6. 调用最终聊天模型前，聊天编排从内部 artifact 组装一次性多模态消息：文本说明“这是本次试穿结果，仅供视觉参考”及受检图片块。此消息通过模型调用的临时参数传入，不追加到 LangGraph 状态消息，因此既有 `persistInput` 只会记录实际用户输入；临时图片上下文不写入 `ChatMessage`、trace 或后续历史。
7. 最终模型只负责返回文字说明。后端把安全的 `{ taskId, product, resultSummary }` 作为 `tryOnResult` 附件与文字响应绑定；它不包含图片 URL、Base64、对象键或用户照片引用。前端使用既有 `GET /api/try-on/tasks/:id` 和 `GET /api/try-on/tasks/:id/result` 按当前登录用户取图，组件展示受控图片。
8. 历史消息恢复时重新校验任务是否仍可由当前用户读取；已删除、失败或无权访问的任务不显示图片附件，聊天正文仍可读取。

### 超时与断开

- 任务仍受现有供应商超时、至多一次自动重试及任务状态规则约束；聊天侧只等待，不另发供应商请求或重复创建任务。
- SSE 先发出安全的运行状态，工具等待期间保持连接；等待上限必须覆盖已配置的单次处理时限与一次重试，并留出轮询余量。部署反向代理、浏览器和 API 的连接时限须在实施前核对。
- 如果 SSE 被用户断开，聊天侧停止轮询和模型调用，但不伪造取消任务；现有后台任务按原规则完成，用户可从“我的试穿”查看结果。
- 等待达到上限但任务仍活动时，工具只返回安全的 `processing` 状态与任务 ID，模型答复正在处理中，前端提供前往“我的试穿”的入口；此分支不把尚未生成的图片交给模型。
- 供应商最终失败、模型不支持图片输入、图片字节/MIME/尺寸校验失败时返回稳定业务状态。不得将异常对象、供应商原文、图像 Base64 或签名 URL用于错误文本。

## 多模态模型输入兼容

当前聊天模型工厂使用 `@langchain/openai` 的 `ChatOpenAI`，并支持自定义 OpenAI-compatible Base URL。LangChain 支持多模态消息内容块，但不同兼容供应商对图片块编码、尺寸、工具后消息顺序和图像输入能力可能不同。

- 实现沿用已安装 `@langchain/core` 消息类型和现有模型适配器，不新增库。
- 仅把已生成的试穿结果图作为模型图片输入；不把原始本人照片传给聊天模型。
- 通过本轮模型调用中的内存图片内容块/受控 Data URL 传输，禁止给聊天模型供应商一个可长期访问的私有对象 URL。
- 按工具生成图限制字节上限，并沿用图像供应商输出校验；超限或 MIME 不在 PNG/JPEG/WebP 白名单时不调用聊天模型。
- 必须使用实际配置的 OpenAI-compatible 模型和合成测试图执行集成 Smoke Test。若目标服务不接受图片内容块，则该模型环境不能启用聊天试穿；不得静默降级为将图片 URL 或 Base64 写入普通工具文本。

## Trace、日志与公开显示安全

| 数据                         | 模型本轮             | 普通 trace / activity | 聊天消息及历史     | 浏览器                   |
| ---------------------------- | -------------------- | --------------------- | ------------------ | ------------------------ |
| 商品 ID、当前颜色            | 允许                 | 仅白名单商品摘要      | 按当前聊天展示规则 | 显示                     |
| 照片 ID、同意版本            | 仅服务端工具上下文   | 不记录原值            | 不保存             | 只在动作请求内发送       |
| 原始照片字节/Base64          | 仅试穿供应商流程     | 禁止                  | 禁止               | 上传照片流程结束后不回传 |
| 生成结果图字节               | 临时传入聊天模型     | 禁止                  | 禁止               | 由本人结果 API 获取      |
| 任务 ID                      | 允许作为安全工具状态 | 可记录稳定任务摘要    | 附件仅绑定任务 ID  | 作为受控读取标识         |
| 存储键、签名 URL、供应商原文 | 禁止                 | 禁止                  | 禁止               | 不进入聊天响应           |

实现要求：

- 试穿动作 trace 参数用专属白名单；不使用通用递归脱敏代替白名单。可记录工具名、`productExternalId`、稳定状态码及必要任务 ID；不得记录 `photoId`、同意版本或图片内容。
- 工具 activity 的公开 `input` 不含照片 ID；`output` 只含有限状态，不含 `artifact`。
- 临时图片上下文不进入 LangGraph `state.messages`，图像字节不调用 trace writer；模型结果通过既有 `visibleMessageContent()` 提取文字，未知的输出图像块不得当成可公开文本。
- `tryOnResult` 进入现有 assistant display envelope，以可选字段兼容旧 JSONB 历史；历史解析使用严格 Zod 投影。不得把临时 image content 写入 envelope。
- 日志仅可包含安全状态码和耗时，不记录请求体、模型消息对象、Buffer、Data URL、对象键、签名 URL、照片内容或供应商响应。

## API/展示结构

聊天响应和实时完成事件增加可选的固定附件：

```ts
type ChatTryOnResult = {
  taskId: string;
  product: {
    externalId: string;
    name: string;
    color: string;
  };
  result: {
    width: number;
    height: number;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  };
};
```

- 只允许服务端从已成功且本人可访问的任务构造该投影。
- 正在处理、失败、图片不可访问、删除或等待超时都不能伪造成成功附件。
- `tryOnResult` 绑定到最终 assistant message；重放历史时由后端按用户边界恢复。
- Web 使用固定组件分发，不从 Markdown、工具输出或助手文字提取图片地址。
- 结果获取沿用现有任务下载 API 和五分钟短期下载能力；短期地址只用于用户浏览器加载，不存入聊天消息、附件 envelope 或 trace。

## 错误投影

| 场景                           | 工具/服务端处理                                               | 前端行为                                     |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------------- |
| 商品不存在、关闭或当前不合格   | 不创建任务，返回 `PRODUCT_NOT_TRYON_SUPPORTED` 或统一不可用码 | 显示不可试穿提示，不渲染附件                 |
| 照片越权、过期、已删除或已绑定 | 不调用图像供应商，沿用照片不可用稳定码                        | 保留选择状态并提示重新选择                   |
| 缺少/过期同意                  | 不调用图像供应商，返回 `CONSENT_REQUIRED`                     | 重新展示当前版本说明和勾选                   |
| 活动任务或额度冲突             | 沿用 `ACTIVE_TASK_EXISTS` / `DAILY_QUOTA_EXCEEDED`            | 提供查看现有任务的入口                       |
| 生图供应商失败                 | 复用任务失败分类，不返回供应商原文                            | 显示可恢复失败状态；无附件                   |
| 工具等待超时                   | 不重复创建任务，返回安全任务状态                              | 可前往任务历史查看进展                       |
| 聊天模型拒绝或不支持图片输入   | 不泄露图像/供应商原文；任务保持已生成且可访问                 | 显示已生成的本人结果附件及文字服务不可用提示 |
| 历史附件任务被删除/无权读取    | 后端省略附件或返回本人范围内 404                              | 展示“结果不可用”，不暴露任务属于其他用户     |

## 测试方案

### API

- Zod：动作合法值、颜色/ID 边界、未知字段拒绝；无动作的旧请求行为不变。
- 工具路由：普通聊天不执行试穿；结构化动作恰好调用一次；工具商品/照片参数被篡改时拒绝；当前用户始终来自认证上下文。
- Port 和任务：商品当前资格、颜色、照片归属、照片状态、同意版本、关闭的真实照片开关、活动任务、每日额度、任务失败/超时/完成及结果归属。
- 多模态：Fake Chat Model 收到生成图内容块与说明文字；模型输入包含结果图但不包含原照片、签名 URL、对象键和 Data URL 文本。
- trace/history：注入唯一标记的源照片和生成图字节后，检查数据库 trace、工具 activity、assistant `ChatMessage.content`、JSONB display envelope 和历史恢复均找不到图片标记、Base64、照片 ID、同意版本或签名 URL；仅允许白名单附件 task ID。
- 失败：SSE 断开不取消/重复后台任务；超时返回 processing；模型失败时成功任务可从本人历史恢复；删除或越权任务不返回图片。
- 兼容：既有聊天、商品/订单展示、普通模型工具和旧版 display envelope 回归。

### Web

- 按当前批准状态不新增 Vitest、Vue Test Utils 或 Playwright 依赖；执行 Web `typecheck` 和 `build`。
- 手工验证商品卡入口、登录状态、照片上传/保存照片选择、颜色选择、明确同意、SSE 生成状态、成功图片加载、下载 URL 到期、任务删除及窄屏显示。
- API 或模型无真实凭据时明确记录未执行；模型集成测试仅使用登记的合成/公开图片，绝不用真实用户照片。

## 验证与范围

- 不新增试穿 Entity、Migration、供应商或 npm 依赖；聊天展示 envelope 使用可选 JSONB 字段并兼容旧历史。
- 复用现有 `TryOnTaskService` 和下载 API，不改变用户隔离、每天 5 次成功额度、单活动任务、一次自动重试、照片清理和删除语义。
- 如果实际实现需要改变任务 API、结果生命周期、第三方照片处理或持久化权限边界，先更新设计/契约并重新审批。
- 技术方案已确认；实施计划单独审批通过前不修改业务代码。

## 文档依据

- 本地能力：`apps/api/package.json`、`apps/api/src/llm/provider/chat-model.factory.ts`、`apps/api/src/llm/graph/llm.graph.ts`、`apps/api/src/virtual-try-on/port/try-on-image-provider.port.ts`、`apps/api/src/virtual-try-on/service/try-on-task.service.ts`。
- [LangChain.js 官方消息文档](https://docs.langchain.com/oss/javascript/langchain/messages)：多模态 `content` 块、工具消息文本和不传给模型的 artifact 语义。最终消息编码需以当前 `@langchain/core`/`@langchain/openai` 版本及实际兼容模型集成测试为准。
- 数据、授权和供应商政策以[虚拟试穿契约](../../contracts/virtual-try-on-crud-contract.md)及[安全边界](../../development/security-and-business-boundaries.md)为准。

## 审批说明

本技术方案于 2026-11-12 获用户确认，采用“结构化动作确定性调用工具、复用现有后台任务并等待、生成图作为本轮临时多模态上下文、结果附件通过本人任务接口交付前端”的路径。实施计划见[聊天试穿工具实施文档](./chat-try-on-implementation.md)，该计划单独获批前不修改业务代码。
