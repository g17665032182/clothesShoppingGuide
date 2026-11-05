# AI 对话界面技术文档

## 状态与依据

- 状态：已确认（2026-11-03，用户回复“确认”）。已按本方案完成实现，验证证据及限制见实施文档。
- 最后更新：2026-11-03。
- 前置依据：[已确认设计](./ai-elements-design.md)、[流式契约](../contracts/chat-streaming-crud-contract.md#2026-11-03-ai-elements-扩展已确认)、[聊天记录契约](../contracts/chat-records-crud-contract.md#2026-11-03-ai-elements-展示扩展已确认)。
- [实施文档](./ai-elements-implementation.md)已确认并已登记交付记录；本文件保留技术方案口径。
- 范围沿用设计：Chat、Message、Prompt Input、Context、Tool、Chain of Thought，以及有真实数据才展示的 Reasoning、Sources。Confirmation、Plan、Stack Trace 不接入。

## 实现目标与现状

| 领域   | 当前仓库事实                                                                          | 本期拟调整                                               |
| ------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 前端   | Vue 3.5、Vite 6、Tailwind 4、Reka UI 2.11；页面已有 `index.vue`、`page.ts` 和私有组件 | 使用当前官方 AI Elements 组合模式，保持页面边界          |
| 请求   | Axios 请求底座与 Fetch adapter 消费 SSE；认识 start/delta/done/error                  | 扩展结构化事件解析，保留认证重试和取消                   |
| 模型流 | Graph 内调用模型 stream，但先聚合完整响应，外层 values 流才发送正文                   | 增加受控 custom 流，传递真实文本片段及运行事件           |
| 工具   | 已有 ToolNode 与 trace 持久化；仅可配置启用 `local_echo_tool`，远程工具注册表为空     | 展示真实执行状态，参数和结果按工具白名单投影             |
| 供应商 | ChatOpenAI 兼容模式，未显式启用公开推理摘要或检索能力                                 | 建立明确的数据适配边界；缺少经验证的数据能力时隐藏       |
| 历史   | 消息表保存正文，用量可空；内部事件已有 JSON payload                                   | 最终模型事件保存独立 publicDisplay，与展示消息同事务绑定 |
| 分页   | 服务端支持消息分页；前端目前固定读取第一页 100 条                                     | 加载最新页并支持向前增量加载，避免长会话丢失最新回复     |

上述事实来自本轮源码与包清单读取。没有通过真实供应商请求、数据库查询或浏览器运行来验证拟调整部分。

## 包、目录与职责

保留 `apps/web`、`apps/api` 的模块边界，不为本次接口类型新建共享包，不让前端引用后端内部类型。

```text
apps/web/src/
  api/types/chat.ts                    请求、响应及公开事件类型
  api/modules/chat.ts                  Axios 调用、分页、SSE 解析
  stores/chat/
    index.ts                            跨路由会话与生成任务
    history.ts                          分页历史、终态核实及持久化合并
    session.ts                          会话和本轮状态模型
    turn.ts                             本轮事件合并、终态处理和视图映射
  pages/chat/
    index.vue                          页面组合与基础绑定
    page.ts                            页面草稿与展示事件协调
    components/
      ChatMessageList.vue              Message Scroller 与消息排列
      ChatAssistantMessage.vue         执行过程、正文、来源、用时组合
      ChatActivityList.vue             Chain of Thought 总览
      ChatToolActivity.vue             单个工具详情
      ChatReasoningActivity.vue        公开摘要
      ChatSources.vue                  来源列表
      ChatComposer.vue                 Input Group、发送、停止
      ChatContextUsage.vue             Context 入口及浮层
      ChatContextDetails.vue           Hover Card/Popover 共用的用量内容
      ChatHistoryNavigation.vue        会话导航与局部交互
  components/ui/                       CLI 引入的基础组件

apps/api/src/
  llm/
    stream/                            模型流事件类型、内容块标准化
    graph/                             Graph 节点与运行事件
    service/llm.service.ts              公开的模块调用入口
    trace/                             既有 trace 写入端口
  chat-records/
    display/                           公开类型、白名单投影、元数据读写服务
    service/chat-records.service.ts     权限、运行编排及事务
    controller/llm-chat.controller.ts   SSE 帧与 HTTP 生命周期
    dto/                               现有输入 schema、Swagger 响应说明
    trace/                             原始事件持久化与幂等
    history/                           仅重建模型上下文
    spec/                              所属模块测试
```

只在存在对应职责时创建文件。基础 UI 不复制到页面目录；现有侧栏、标题、MarkdownRenderer 保留职责。`stores/chat/turn.ts` 只处理消息快照，不执行请求；聊天页面草稿仍为页面局部状态。

依赖方向为 `chat-records -> LlmService`。LLM 运行类型由 LLM 模块自己的公开入口导出；公开展示投影属于 chat-records。禁止 LLM 导入 chat-records 的 Entity、Repository 或展示 DTO，也不将整个 Graph state 发往前端。

## 依赖与组件组合

继续使用 pnpm 12.14.0。前端使用 `reka-nova`、`@lucide/vue`、`@/components/ui`、`@/lib/utils` 和现有语义颜色变量，不改 preset 或全局主题。

| AI Elements 模式 | 采用的基础组件                                                     | 项目适配                                                                           |
| ---------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Chat             | MessageScrollerProvider、Scroller、Viewport、Content、Item、Button | Provider 开启 auto-scroll；用户消息设 scroll-anchor；移除原 scrollIntoView watcher |
| Message          | Message、MessageContent、Bubble、BubbleContent                     | 用户使用 Bubble，助手组合执行过程与现有 MarkdownRenderer                           |
| Prompt Input     | InputGroup、InputGroupTextarea、Addon、Button                      | 保留 maxlength 2000、中文输入法、发送与停止行为                                    |
| Context          | HoverCard、Progress；补充 Popover                                  | 共用详情内容，提供点击和键盘入口                                                   |
| Tool             | Trace、TraceLine、TraceCollapsible、CodeBlock                      | 只呈现已投影字段，不执行客户端工具                                                 |
| Reasoning        | TraceCollapsible                                                   | 作为总览内的公开摘要步骤，不复制一份独立内容                                       |
| Chain of Thought | Trace 与嵌套 TraceCollapsible                                      | 依据实际活动计算数量与状态，保留用户展开选择                                       |
| Sources          | Trace 与 TraceCollapsible、普通链接                                | 稳定 ID、合法 URL、网站名和外链提示                                                |

已读取 CLI `docs` 输出以及当前官方 Chat、Context、Reasoning、Tool、Chain of Thought、Sources 和基础组件文档。它们是可组合的 UI 模式，不要求引入 AI SDK 或旧版 AI Elements Vue 包；项目继续使用 Nest、LangGraph 与 Axios。

本地已有 Button、Badge、Alert、Empty、Field、Spinner 等能力，优先复用。拟新增 Message、Bubble、Message Scroller、Input Group、Hover Card、Popover、Progress、Trace、Code Block、Collapsible、Tooltip、Skeleton 及其必要依赖；实施阶段先核对实际已安装清单，再按需添加。

Code Block 官方组件使用 Shiki；若使用该组件，由 CLI 声明其依赖，延迟加载高亮能力。正文继续复用 `@crazydos/vue-markdown`、remark-gfm、rehype-highlight 和 highlight.js，不同时迁移 Markdown 引擎，也不引入 Comark。

实施阶段必须执行 CLI dry-run/diff，保护现有 Button、Input、Textarea 等组件，不能使用未经授权的 `--overwrite`。生成后逐文件审查 import、模板表达式、Reka data 属性兼容及组件依赖，再做类型检查和构建；文档 API 可用不代表生成源码已在本项目验证。

## 公开类型与传输

下列为接口类型说明，不是本轮新增的源码：

```ts
type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type ChatActivity =
  | {
      type: 'tool';
      id: string;
      toolName: string;
      status: 'running' | 'success' | 'error' | 'interrupted';
      input: JsonValue;
      output: string | null;
    }
  | { type: 'reasoning'; id: string; summary: string };

type ChatSource = { id: string; title: string; url: string };

type ChatContextUsage = {
  contextWindowTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usedTokens: number | null;
};
```

`JsonValue` 的 number 必须有限；Token 数量必须是非负安全整数，窗口必须是正安全整数。未知数量使用 null，不能通过默认值变成零。公开对象使用字段白名单组装，不进行对象整体展开。

| SSE 事件 | 增量约定                                                                 |
| -------- | ------------------------------------------------------------------------ |
| start    | 现有 conversationId、title，加本轮 contextWindowTokens                   |
| delta    | `{ content: string }`，只追加可展示正文                                  |
| activity | `{ activity: ChatActivity }`，完整替换同 ID 活动，保留首次出现顺序       |
| sources  | `{ sources: ChatSource[] }`，完整替换本轮来源列表                        |
| done     | 现有 conversationId、title、model、usage，加 context；提交成功后发送一次 |
| error    | 现有 `{ message: string }`，结束流，后续无 done                          |

历史消息增加 `activities`、`sources`、`context`。用户消息和旧记录的默认值为 `[]`、`[]`、null。普通 JSON 聊天响应保留原有结构；其新成功记录也可在内部保存同口径展示元数据，供后续详情读取。

API 层在 JSON.parse 后逐项检查判别字段、ID、状态、有限数字、URL 与数组结构；TypeScript 断言不代替运行时检查。未知事件继续忽略；已知事件格式非法则终止为协议错误。重复 activity 更新不增加步骤数量；sources 快照不得进行再次累加。

兼容旧后端时，缺少新增字段映射为空数组/null 或未知窗口，不伪造数值；新增后端仍发送旧事件必填字段。已声明但类型错误的新增字段视为协议错误。发布优先后端再前端，不要求一次性原子部署。

SSE 帧处理保留 UTF-8 跨块解码、多行 data、CRLF、空行分帧和 EOF 检查。收到 error 即作为失败终态；done 作为成功终态，禁止后续业务事件覆盖终态。提前退出时取消 reader 并释放锁，清理请求与监听器。

## LLM 真实增量与工具流程

复用 LangGraph 的 custom 和 values 流。当前安装类型中的 `Runtime.writer` 与官方文档均提供 custom 事件入口；保留现有 graph 拓扑和 ToolNode，不另造执行引擎。

拟增加 `LlmService.streamEventsPrepared()` 作为类型化内部入口，输出正文增量、规范化工具调用/结果、公开摘要候选和结构化来源候选。原 `streamPrepared()` 与 `stream()` 保留字符串包装，避免影响已有调用方；JSON invoke 路径保持原行为。

处理顺序：

1. 保持现有输入准备、上下文和记忆注入；先保存 input trace。
2. 模型节点遍历真实 chunk，通过统一文本适配器即时发送已识别的正文片段，并继续聚合完整 AIMessage。
3. 模型响应结束，持久化 model_response 与完整 tool_call；只有工具 ID、名称、参数完整且 trace 成功保存，才发送工具 running 并进入 ToolNode。
4. ToolNode 执行工具；persistToolEvent 写入成功后发送对应结果更新，再开始下一次模型调用。
5. 最后一次无工具调用的模型响应完成，取得该调用的实际 usage 与最终 trace 定位信息。
6. chat-records 完成公开投影及消息事务保存，再发送 done。

工具参数片段、原始 reasoning、未知内容块绝不作为 delta。正文适配器仅接受供应商正文字符串或明确的 text/output_text 类块，不能使用“任何含 text 属性的对象都是正文”的旧宽松转换。

为了保证真正的增量输出，本方案允许工具调用前的可展示引导文本按原顺序进入正文。流式成功保存的 assistant.content 必须等于本轮所有 delta.content 的精确拼接，包括这些引导文本；最后完整模型消息只用于校验和获取最终用量，不能再次发送或覆盖已输出正文。内部 trace 仍逐次保留各模型响应，不能将拼接文本重复写回模型运行历史。此项只调整流式展示，不改变普通 JSON 路由返回最终回复的行为。

若上游只返回整段字符串，则只能按实际到达时机输出，禁止用定时器模拟 Token 流。空正文、非法工具调用、trace 失败或异常均不产生成功 done。工具返回错误状态时发送安全 error 活动并使本轮失败，不让 ToolNode 将错误结果悄悄包装成成功轮次；尚未结束的其他工具统一转为 interrupted。

Graph custom 通道只在服务端传递规范化运行数据。chat-records 对活动进行公开投影后才能进入 SSE；values 只用于检查最终状态，不直接序列化。对外循环保留 `response.write`/drain 背压处理，同时实施阶段必须验证 Graph 内部队列有界；仅等待 HTTP drain 不能证明上游队列有界。若现有 Graph 无法限制积压，使用其官方 messages 流等价能力重新核验方案，不能留下无上限缓存。

## 公开投影、Reasoning 与 Sources

实时与历史共用 chat-records/display 的规则。凭证字段递归掩码只作第二道防线，不能把经过掩码的任意工具对象认定为可公开。

| 数据            | 投影规则                                                                              |
| --------------- | ------------------------------------------------------------------------------------- |
| 已知工具        | 独立 allowlist 声明安全显示名、输入字段、结果转换与错误摘要                           |
| local_echo_tool | 不直接公开任意 value 或原样回显结果；只显示“本地验证工具”、状态，input/output 为 null |
| 未知工具        | 使用服务端注册名称的安全映射，无映射显示通用名称；input/output 为 null                |
| 错误            | 只返回固定安全摘要，原始异常、路径及堆栈留在内部日志                                  |
| 公开摘要        | 只接受供应商明确声明为公开 summary 的受支持结构；同 ID 替换 summary                   |
| 来源            | 只接受实际工具检索结构或经适配器验证的供应商 citation 元数据                          |

公开摘要不等于 LangChain 任意 reasoning 块，不能读取 `reasoning_content`、模型隐藏过程或让模型补写“推理”。本期不为了展示而改 Prompt 或启用供应商特有 API；当前工厂配置无法证明具备公开摘要能力，因此默认无摘要。适配器只有在官方结构、脱敏样本和测试一致时才能启用，不支持时返回空数据。

来源使用标准 URL 解析：只允许绝对 HTTP/HTTPS，禁止用户名密码、相对地址、空主机及非外部地址。不请求 DNS，不抓取网页，不生成 favicon 或预览请求。禁止从正文链接、模拟商品或回显字符串采集来源。

用 URL 序列化后的值作为本轮去重键，保留路径、查询与片段，不自行移除可能影响资源含义的参数。首次采集时分配本轮稳定 ID；重复 URL 保留首次顺序，允许以有效标题更新原项。标题缺失时使用 hostname，页面以纯文本渲染。历史恢复重新校验链接并去重，保留已存 ID。

来源在新页面打开，使用 `rel="noopener noreferrer"`，提供可读的外链提示。当前没有检索工具，允许真实运行中始终不显示 Sources；测试使用结构化 fixture，不新增搜索服务或生产数据。

## Context 口径

窗口来自已有 `LLM_CONTEXT_WINDOW_TOKENS` 配置，经现有配置路径校验，在 prepare 阶段固定为本轮快照。start 与 done 使用同一值，成功后保存该值。历史读不能套用当前配置。

- 只从本轮最终模型响应读取 usage，不使用 Graph state 中可能残留的前次 usage。
- inputTokens 与 outputTokens 均已知时，usedTokens 等于两者之和；不使用供应商 totalTokens 替代缺失分项。
- 真实零值保留。缺失、不合法或无法确认口径的项映射为 null，不根据字数估算。
- 不累计工具循环、历史轮次、摘要调用或记忆提取调用的用量，不额外叠加可能已包含在 output 中的 reasoning 数量。
- 窗口和 usedTokens 均有效才显示比例；进度条限制在 0～100 的视觉范围，数值仍显示真实用量，不能把超出窗口的数据静默改小。
- 生成期间显示当前会话最近已完成助手消息的统计，并标明“上一轮”；当前轮 done 后切换。切换会话立即重新派生，不能沿用前一会话数据。

Context 详情仅展示输入、输出、合计、窗口及统计归属，不展示费用和下一轮预测。桌面支持 Hover Card；点击、Enter、Space 使用 Popover，Escape 关闭并恢复焦点。两种浮层共用详情组件并协调 open 状态，同一时刻只打开一个，不嵌套交互按钮。无数据时入口仍可说明“暂无数据”。

## 持久化、事务与幂等

复用 `chat_trace_events.payload`，不修改 Entity、索引或 Migration。技术可行性依据是已有 JSON 字段、runId/sequence 唯一键、MikroORM 嵌套 JSON 查询与事务支持；实际 SQL、锁和回滚须在实施阶段验证。

最终 model_response 的 payload 中新增独立命名空间：

```ts
type PublicDisplayEnvelope = {
  version: 1;
  assistantMessageId: string;
  activities: ChatActivity[];
  sources: ChatSource[];
  context: ChatContextUsage;
};
```

外层键为 `payload.publicDisplay`，保留既有其他 payload 字段。assistantMessageId 绑定展示消息 UUID；既有 trace.messageId 仍是 LangChain ID，不挪作展示 ID。最终 trace 由本轮 runId 与明确 sequence 定位，不能通过“全会话最后一条事件”猜测。

保存流程：

1. 聚合本轮安全展示数据，完成边界检查，确定最终 trace 标识。
2. 在现有 `persistChat()` 事务中保存会话和 user/assistant 消息，沿用摘要和记忆任务入队。
3. 使用同一个事务 EntityManager 锁定本轮最终 model_response，核对 conversationId、runId、sequence 与事件类型。
4. 合并 publicDisplay、再次检查完整 payload 大小并 flush；任何消息、元数据或入队失败均回滚展示消息事务。
5. 事务返回成功后才发 done，绝不先宣布成功再补元数据。

既有内部 trace 在运行期间已独立提交，后续展示事务失败时按原契约保留，不假称所有 trace 都属于最后事务。新会话取消时只在展示事务未成功的前提下清理会话及 trace；提交后观察到断连不能再删除已保存轮次。

### 容量与溢出

既有 trace 单个 payload 上限是 UTF-8 序列化后 32,768 字节。拟为 publicDisplay 设置 16,384 字节预算，并同时验证合并后完整 payload 不超过既有上限；字节数必须包含键名、JSON 转义、数组、中文及绑定信息。

在发送每次 activity/sources 更新前检查候选完整快照预算，预留 context、version、消息 UUID 的空间；提交前再以最终内容复核。工具结果不做无限展开。超过预算时以安全错误结束本轮，不发送超限数据、不保存半成品消息、不发送 done；不能在实时展示后静默丢弃历史元数据，也不通过临时扩大上限绕过限制。

该预算是本技术方案已确认的资源约束，实施测试须覆盖预算边缘与多字节文本。若实际公开摘要/来源规模无法满足，回到设计阶段确认专用存储方案，不自动创建新表或迁移。

### 幂等与历史隔离

当前 trace `sameEvent()` 比较整个 payload；后加 publicDisplay 会使同一事件重放发生冲突。拟仅对 model_response 的自有 `publicDisplay` 字段做比较隔离：原始 payload 为 null 与只含 publicDisplay 的对象按同一原始空值处理，其他原始字段仍必须逐项一致。写入端禁止外部运行事件自带该保留字段。

绑定操作在行锁内执行：相同 assistantMessageId 与相同内容重复绑定为幂等；不同绑定或不同快照返回 ConflictException。事件重放不得覆盖已经绑定的 publicDisplay。保留原 conversationId/runId/sequence 唯一约束，不增加“同文本就是同消息”的判定。

`mapTraceEventsToMessages()` 继续只读取原模型/工具字段；publicDisplay 不参与模型历史、摘要、系统上下文或记忆提取。测试必须证明新增元数据不会改变下一轮 LangChain 消息。

## 历史读取与长会话

先执行现有普通用户归属或管理员权限检查；越权与不存在仍为 404。取得当前页消息后，收集 assistant ID；没有助手消息则不查询展示元数据。

display reader 使用 EntityManager/Repository，限定 conversationId、eventType=model_response，以及 `payload.publicDisplay.assistantMessageId` 在当前页 ID 集合内。通过嵌套 JSON 条件表达，参数由 ORM 绑定；只选择所需 ID、runId、sequence、payload 等字段，不加载全会话 trace 或逐条 N+1 查询。

对读出的 version、绑定、公开类型、状态、URL 及预算重新验证。缺失或无效元数据降级为空展示字段并记安全日志，不能使旧正文不可读；同一消息出现冲突绑定时不随意选取一条。返回手工组装的 DTO，不返回 trace Entity、payload 或提供 trace 查询新路由。

已有 conversationId 索引可缩小扫描范围，但新增 JSON 条件没有独立索引；“只返回当前页结果”不代表已证明扫描成本可控。实施阶段检查生成 SQL、查询次数和大样本执行计划；若必须新增索引或模型关联，重新审批设计与契约。

前端 `getConversation` 增加显式 page 和 signal 参数。首次请求读取分页总数，再定位最后一页；最新页不足一轮时补取前页。向上加载更早页面，按消息 ID 去重，维持服务端时间顺序；使用 Scroller 的 preserve-scroll-on-prepend 保持阅读位置。不一次拉取全部历史。

收到 done 后重新读取最新页确认服务器 ID 和元数据；刷新失败保留已由 done 确认成功的临时视图并提供重试，不能误报生成失败。页数在查询期间变化时重新核对最新页；整个链路受同一请求版本及 AbortController 保护。

## 页面状态、终态与生命周期

历史请求沿用可区分的 idle/loading/success/empty/error 状态。发送另用 ready/submitted/streaming/saved/failed/interrupted/uncertain，避免用一个布尔值代替全部状态；isSending、canSend 等由状态同步派生。

- 提交时创建 user 和 assistant 临时占位，活动或来源可先于首个正文到达；普通等待提示不算一个步骤。
- 所有异步入口捕获 requestVersion 和 conversationId，处理事件、刷新、catch、finally 前均核对版本。包括 `refreshUncertainTurn`，不能只保护主 SSE 请求。
- 活动按 ID 更新且保留顺序；总览、工具和摘要各渲染一次。状态文字与图标同步，不能只用颜色表达状态。
- Trace 展开状态保留 undefined/true/false：undefined 才遵循运行中展开、结束收起；用户设置优先，外层收起不销毁内层状态。
- 统一终态处理清理生成计时器，把剩余 running 工具转为 interrupted，覆盖 error、协议错误、EOF、停止、切换与卸载。
- 停止请求后保留临时内容并标记未完成；未收到 done 的轮次不得作为正式历史发送，也不自动重试 POST。
- 服务端事务可能已提交而 done 未送达，使用 start 会话 ID 刷新核实。发现新增已保存消息可恢复正式历史；未发现消息不能证明事务已经停止，继续保持待核实并允许再次只读刷新。
- 缺少运行状态接口时不能承诺自动判定“确定未保存”；若后续要求自动解除待核实状态，须回到设计确认新能力。本期不增加轮询、后台重发或新状态路由。

2026-11-05 更新：生成任务和会话缓存迁入 `src/stores/chat/` Pinia Store；原 `pages/chat/chat-turn.ts` 迁至 `stores/chat/turn.ts`，页面仅维护草稿和展示绑定。新建、切换会话及站内路由卸载不取消生成，每个任务只更新所属会话；生成中的会话禁止删除。主动停止和真实断流仍保留未知状态，退出登录、认证身份变化或应用销毁清理全部任务。详见[后台生成说明](./background-generation.md)，继续复用既有路由鉴权。

## 请求 Schema、HTTP 错误与 Swagger

本期扩展响应，不增加客户端可控制的模型窗口、公开活动、工具参数或系统指令。

| 位置             | 现有 schema/类型                                                   | 规则与绑定                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 聊天 Body        | `llm/dto/chat.dto.ts` 的 chatSchema；ChatInput 从 z.infer 派生     | strictObject；conversationId 可选 UUID；messages 1～20；角色仅 user/assistant；正文 trim 后 1～8000；总长不超过 32000；`@Body({ schema: chatSchema })` |
| 列表及详情 Query | `chat-records/dto/pagination.dto.ts` 的 paginationSchema           | strictObject；page/pageSize 转数字并验证整数，默认 1/20，pageSize 最大 100；transform 为 PaginationDto；`@Query({ schema })`                           |
| 管理员列表 Query | `chat-records/dto/admin-chat-query.dto.ts` 的 adminChatQuerySchema | 同分页，另有可选 UUID userId，transform 为 AdminChatQueryDto                                                                                           |
| 详情/删除 Param  | 现有 `z.uuid()`                                                    | `@Param('id', { schema: z.uuid() })`；不新增自制校验器                                                                                                 |

分页 schema 的 `z.input` 表示转换前输入，`z.output` 表示转换后的 DTO；业务逻辑消费输出类型。所有对象请求默认拒绝未知字段。前端 ChatRequestMessage 去掉与服务端不一致的 system 角色，不能因此放宽后端角色或长度规则。

Nest StandardSchemaValidationPipe 的不合法输入继续映射 400；未登录为 401，管理员角色不足为 403，资源越权/不存在为 404。响应头发送前完成可预知的校验及配置检查；响应后只用安全 error 帧，不尝试修改 HTTP 状态。

保留 `text/event-stream; charset=utf-8`、`no-cache, no-transform`、`X-Accel-Buffering: no`、AbortController 和 drain 处理，不新增心跳与重放。Swagger 更新事件说明、样例、消息展示字段及已存在错误响应；DTO 只负责文档，运行时校验仍由 Zod 承担。

## 安全、布局与可观测性

- Markdown 复用现有安全边界，明确禁用原始 HTML；链接仅允许安全协议。不新增未经处理的 v-html。
- 工具详情与摘要优先纯文本、Code Block，不解析成可执行 HTML。工具输入即使字段名普通，也不能默认可公开。
- 事件日志记录 runId、会话 ID、事件类型、大小和安全错误分类；不得记录密钥、系统指令、记忆全文、原始供应商对象或公开摘要全文。
- 消息区域使用 min-width: 0 与受限滚动；长表格、代码和 URL 在自身容器换行或横向滚动，不能撑破移动端。
- 复用官方语义颜色、按钮与图标；图标按钮有可访问名称和 Tooltip。浮层无需手工 z-index，不嵌套按钮。
- 使用 aria-busy、克制的状态播报和减弱动态效果，避免每个 Token 都触发屏幕阅读器重复播报；Trace 状态同时提供文字说明。

## 测试方案与验收

复用后端现有 `tsx --test`、Fake Model、模拟工具及事务测试替身；新增测试放在所属模块 spec。自动化测试不依赖真实密钥、模型供应商、生产服务或外部网络。

| 验证域     | 必须覆盖的行为                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| 模型流     | 第一片正文先于模型完成到达；多轮工具文本不重复；delta 拼接等于保存正文；未知 text 属性块和原始 reasoning 不泄露 |
| 工具       | 调用 trace 先于执行；同 ID 更新；并发与异常；工具失败不发 done；取消后没有残留 running                          |
| 公开投影   | 未知工具隐藏详情；回显中的敏感字符串不公开；公开 summary 与原始 reasoning 区分；实时/历史使用相同过滤           |
| 来源       | 结构化来源、URL 解析、凭证与危险协议拒绝、去重顺序、稳定 ID、无正文抓取                                         |
| Context    | 最后调用口径、前轮 usage 不回退、null 与真实零值、历史窗口、溢出和未知值                                        |
| 保存       | 消息与 publicDisplay 同事务；flush/绑定/入队失败无 done；提交后断连不误删；无最终 trace 不保存半成品            |
| 幂等       | 绑定后事件重放不冲突，原始字段变化仍冲突；重复绑定一致/不一致；展示元数据不进入模型历史                         |
| 容量       | UTF-8、JSON 转义、预算边界、实时与提交一致、超限安全失败                                                        |
| 历史与权限 | 先鉴权、越权 404、管理员权限；旧记录兼容；当前页限定查询、无 N+1；无效元数据降级                                |
| 请求边界   | 合法/非法 UUID、长度、system/未知角色、额外字段、分页转换/默认/范围；通过真实 Nest 参数绑定验证 400             |
| SSE/HTTP   | UTF-8 分帧、多行 data、背压/断连、唯一 done、error 终止、认证刷新、响应前 HTTP 错误                             |

前端遵守 AGENTS 当前约定，不安装 Vitest、Vue Test Utils 或 Playwright，不新增前端测试脚本。以类型检查、构建与浏览器人工联调验证桌面/移动端、IME、回到最新、向前分页、键盘浮层、异常恢复、快速切换会话和长内容。

如现有环境已提供浏览器验证能力，可使用其操作页面并留存结果；未执行的浏览器或数据库检查必须明确记录，不能勾选为通过。

实施阶段验证命令：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm check
git diff --check
```

如仓库全量格式检查被未修改的生成文件阻断，应如实报告并补充变更文件定向检查，不改无关文件以掩盖问题。普通功能验证不执行 migration:fresh。

## 实施前仍需核验的限制

1. 公开摘要与结构化引用的实际供应商能力未验证；无证据则隐藏，不能临时启用新供应商模式。
2. CLI 组件生成源码、Shiki 加载和现有 Reka 版本兼容未构建验证，必须在获准实施后检查。
3. JSON 条件生成 SQL、事务锁、查询计划和 16 KB 展示预算仅完成方案核对，尚未通过数据库验证。
4. custom 流的背压和队列边界必须用慢消费者验证；不满足时停止集成并复核方案。
5. 无运行状态路由时，仅凭一次刷新无消息不能证明“确定未保存”；本期保留待核实语义。
6. 若需要改变数据结构、授权、供应商配置或新增 API，回到设计和契约审批，不由实现阶段自行扩大范围。

## 官方参考

文档核对日期为 2026-11-03；官方示例中的假数据、AI SDK 适配及缺失用量归零做法不直接照搬为本项目业务规则。

- [Chat](https://www.shadcn-vue.com/docs/ai-elements/chat)、[Message](https://www.shadcn-vue.com/docs/ai-elements/message)、[Prompt Input](https://www.shadcn-vue.com/docs/ai-elements/prompt-input)。
- [Context](https://www.shadcn-vue.com/docs/ai-elements/context)、[Reasoning](https://www.shadcn-vue.com/docs/ai-elements/reasoning)、[Tool](https://www.shadcn-vue.com/docs/ai-elements/tool)。
- [Chain of Thought](https://www.shadcn-vue.com/docs/ai-elements/chain-of-thought)、[Sources](https://www.shadcn-vue.com/docs/ai-elements/sources)。
- [Message Scroller](https://shadcn-vue.com/docs/components/message-scroller)、[Trace](https://shadcn-vue.com/docs/components/trace)、[Code Block](https://shadcn-vue.com/docs/components/code-block)。
- [Hover Card](https://shadcn-vue.com/docs/components/hover-card)、[Popover](https://shadcn-vue.com/docs/components/popover)。
- [LangGraph JavaScript streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)：custom writer 与多模式流。
- [MikroORM 7.2.5 JSON properties](https://github.com/mikro-orm/mikro-orm/blob/v7.2.5/docs/docs/json-properties.md)、[EntityManager](https://github.com/mikro-orm/mikro-orm/blob/v7.2.5/docs/docs/entity-manager.md)：JSON 条件、字段选择和事务能力。
