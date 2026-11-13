# 对话工具扩展技术文档：本人试穿任务查询

## 状态与范围

- 状态：2026-11-13 用户确认首期技术及[实施文档](./chat-tool-expansion-implementation.md)，并要求 agent team 实施；代码已接入，实际验证与缺口见实施记录。
- 最后更新：2026-11-13。
- 依据：[扩展设计](./chat-tool-expansion-design.md)、[增量契约](../contracts/chat-tool-expansion-crud-contract.md)，首期已获用户确认。
- 关联契约：[用户信息查询](../contracts/chat-user-information-crud-contract.md)、[虚拟试穿](../contracts/virtual-try-on-crud-contract.md)、[长期记忆](../contracts/user-memory-crud-contract.md)。

只扩展 `get_my_information` 的 `try_on_tasks` section，不新增工具名、HTTP 路由、SSE 事件、卡片、页面、数据库字段或迁移。SKU、偏好明细、编辑界面、物流和售后不在本技术方案内。

## 已核对的本地能力

| 能力     | 当前源码事实                                                               | 首期选择                                               |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| 信息查询 | `ChatUserInformationService.lookup()` 支持三类 section，独立容错           | 显式新增第四类，保留省略 sections 时的三类默认值       |
| 任务列表 | `TryOnTaskService.list()` 返回包括商品图片 URL、结果 ID 的本人 UI 投影     | 在试穿模块提供独立的最小查询入口，不把 UI DTO 传给聊天 |
| 地址协调 | `PurchaseAddressCoordinator` 单独处理 addresses，其他 section 转发信息服务 | 沿用转发；试穿查询不触发地址选择或动态表单             |
| 工具历史 | `chat-history.mapper.ts` 已成对隐藏 `get_my_information` 调用和结果        | 复用，不新增历史工具类型                               |
| 追踪     | `safeInformationArguments()`、`safeInformationProjection()` 当前只识别三类 | 扩充枚举和安全计数，不保存任务条目                     |
| 记忆资格 | 消息已有 `memoryExtractionEligible`，来源与摘要已有过滤机制                | 对试穿查询轮次设置不可提取，保留原购买判断             |

当前服务中的“其余 section 当作 photos”分支需要显式拆开，不能仅扩展 schema 后沿用默认分支。现有任务列表只有创建时间排序，新的聊天查询须增加同时间的稳定排序。

## 依赖依据

实测安装版本：`zod` 4.6.7、`@langchain/core` 1.3.0、`@langchain/langgraph` 1.5.2、`@mikro-orm/core` 7.2.5、`@nestjs/common` 12.2.0。不新增或升级依赖。

技术文档阶段在线检索未成功，当时使用以下安装包随附的官方类型声明和实现核对调用能力：

- `zod/v4/classic/schemas.d.ts`：`strictObject` 及现有 schema API。
- `@langchain/core/dist/tools/index.d.ts`、`index.js`：Zod 4 工具输入解析及解析失败异常。
- `@mikro-orm/core/EntityManager.d.ts`、`drivers/IDatabaseDriver.d.ts`、`enums.d.ts`：`findAndCount()`、`fields`、`transactional()`、`isolationLevel`、`readOnly`。
- 现有 Nest Controller 的 `@Body({ schema: chatSchema })` 和项目 `StandardSchemaValidationPipe` 接线。

实施阶段通过 Context7 补充核对 LangChain 官方工具/schema 文档及 Zod 4 strictObject、default、input/output 文档，继续以安装版本声明为调用依据。未增加或升级依赖。

实现前若发现锁文件或安装版本变化，重新核对对应声明和官方文档，不依据其他版本示例迁移现有框架。

## 模块与文件范围

| 模块                    | 预计文件                                                                                                              | 职责                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `virtual-try-on`        | 新增 `dto/try-on-task-metadata.dto.ts`、`service/try-on-task-reader.service.ts`；更新 `index.ts`、模块接线及所属 spec | 读取本人任务与有效结果标志，输出安全 DTO        |
| `chat-user-information` | 现有 schema、response、Service、Module、公开导出和所属 spec                                                           | 新 section 校验、调用、二次白名单投影和独立错误 |
| `chat-records`          | `tools/chat-user-information.tool.ts`、Service、trace 及所属 spec                                                     | 绑定身份、标记运行资格、追踪枚举与回归          |
| `llm`                   | `context/system-context.md`、必要的 `shopping-flow.md` 说明及提示词测试                                               | 明确查询时机和结果解释边界                      |

不调整既有 Entity 或任务创建、Worker、下载、删除实现。保留 `.js` 相对导入。必要代码注释使用中文。

试穿模块新增独立只读 Service 的原因是任务创建/下载 Service 同时依赖存储、图片和额度能力；聊天只应注入最小查询入口。本轮复用领域实体与 ORM 查询，不另建资源系统或通用查询框架。

### 公开接口与注入

`VirtualTryOnModule` 提供并导出 `TryOnTaskReaderService`，`virtual-try-on/index.ts` 导出该 Service 及输入/输出类型。其他模块不得深层导入试穿 Entity、Repository 或私有查询方法。

拟定公开接口：

```ts
type TryOnTaskMetadataQuery = {
  page: number;
  status?: 'queued' | 'processing' | 'succeeded' | 'failed';
};

class TryOnTaskReaderService {
  listMetadataForUser(
    userId: string,
    query: TryOnTaskMetadataQuery,
  ): Promise<TryOnTaskMetadataPage>;
}
```

DTO 和允许状态定义在试穿模块的 DTO 文件中，通过公开入口导出。`ChatUserInformationModule` 已导入 `VirtualTryOnModule`，直接注入新增公开 Service；不增加反向依赖，不暴露 `CHAT_TRY_ON_PORT` 或存储客户端。

## 输入 Schema 与错误边界

在现有 `chat-user-information.schema.ts` 更新 `getMyInformationSchema`，保留工具入口使用同一个 schema。

| 字段                | 输入及解析后规则                                                                      |
| ------------------- | ------------------------------------------------------------------------------------- |
| `sections`          | 可省略；严格枚举四类，1–4 项，不重复；省略仍解析为 addresses/orders/photos            |
| `tryOnStatus`       | 可省略，只接受四个未删除状态；仅包含 try_on_tasks 时允许                              |
| `page`              | 可省略，默认 1；`z.number().int().safe().min(1).max(10)`，不转换字符串                |
| `orderNo`、`status` | 保留原 trim、长度和订单状态规则；仅包含 orders 时允许                                 |
| 其他字段            | `z.strictObject` 拒绝；包括 userId、taskId、photoId、unread、pageSize、URL 和动作参数 |

定义 `GetMyInformationSchemaInput = z.input<typeof getMyInformationSchema>` 表达可省略默认项的原始输入，保留 `GetMyInformationInput = z.output<...>` 表达传给查询编排的解析后类型。不在 Controller 或 Service 复制模型输入校验。

试穿公开查询也定义模块内严格 schema：页码实际整数 1–10、可选四状态，无 pageSize；服务端传入的 userId 是独立的受信参数，不放入模型 schema。模块内校验用于保护其他内部调用者。

本次没有新增 Body、Query、Param。现有聊天 HTTP Body 仍由 `chatSchema` 和 Nest Pipe 校验：非法 HTTP 请求在开流前返回 400，未登录/禁用账号沿用 401，会话越权沿用 404。模型产生的非法工具参数在 HTTP 请求开始后发生，属于工具/流错误，不能描述成必然返回 HTTP 400。

本地 LangChain 在回调前解析 schema，解析异常可能包含校验细节；沿用图的固定“工具执行失败”公开错误通路，trace 和 activity 不透传异常输入或原始错误。首期不修改 ToolNode 的全局失败策略，不承诺非法参数可以在同一轮自动重试成功。

## 任务读取与响应

### 查询和一致性

1. 每次调用创建独立 EntityManager fork，在短只读、`REPEATABLE READ` 事务中执行查询，不跨模型调用持有事务。
2. 任务条件始终包括 `userId`、`deletedAt: null` 和允许状态；无筛选时为四种非删除状态，拒绝查询 deleted。
3. 用同一条件读取真实总数及当前页；排序为 `createdAt DESC, id DESC`，`limit: 5`、`offset: (page - 1) * 5`。
4. 只选择任务 ID、状态、商品快照字段和创建/完成时间。不得加载照片引用、对象键、商品图、供应商原文或执行参数。
5. 仅对当页至多 5 个任务批量查询结果存在性，条件包括本人 userId、当页 taskId、`deletedAt: null`；业务只需 taskId，不读取 objectKey 或图片字段。若 ORM 为部分加载补充结果主键，主键仅留在领域内部，不进入安全 DTO。空页不查询结果。
6. `resultAvailable` 为任务 succeeded 且同一快照下存在本人未删除结果。该字段表示数据库当前有可查看结果记录，不探测存储对象，也不保证随后下载一定成功。

查询失败整体交给该 section 的容错边界。没有记录或越界空页正常返回成功；非法或损坏的领域投影不得伪装成成功空页，不以跳过条目再保留原 total 的方式隐藏问题。

事务只读且不修改已加载实体，不调用 persist、任务领取、quota、notification-read、Worker 或存储方法。批次无需逐任务 N+1 查询。无需新锁、新索引或迁移；若真实验证发现性能问题，另行评估，不能自行改变数据结构。

新请求会读取新快照；跨页查询期间新增任务可能改变列表，稳定排序不代表整个多轮聊天拥有冻结的分页快照。

### 白名单 DTO

`TryOnTaskMetadataPage` 固定为 `{ items, page, pageSize: 5, total }`，项目字段如下：

| 字段                       | 约束                                   |
| -------------------------- | -------------------------------------- |
| `taskId`                   | 本人任务 UUID，仅安全引用              |
| `status`                   | 四种非删除状态                         |
| `product.externalId`       | 原领域标识，1–160 字符                 |
| `product.name`             | 原任务快照名称，1–200 字符             |
| `product.category`         | tops/bottoms/dresses/outerwear         |
| `product.color`            | 原任务快照颜色，1–32 字符              |
| `createdAt`、`completedAt` | ISO 时间；未完成的 completedAt 为 null |
| `resultAvailable`          | 布尔值                                 |

字符串不得含控制字符；商品描述作为数据解释，不作为系统指令。模块输出 schema 拒绝未知字段，信息 Service 再按白名单显式组装，不 spread Entity 或 UI DTO。损坏响应映射为本 section unavailable，不返回原始输入片段。

`taskId` 不供模型发起详情、图片或写操作；首期只提示用户进入原“我的试穿”页面。任何查看、下载或删除继续通过本人 API 重新认证与校验。

## 查询编排与运行状态

`ChatUserInformationService.lookup()` 显式分派四种 section，保留各自独立 try/catch。试穿结果加入 `sections.try_on_tasks`；失败时省略该 section，加入 `{ section: "try_on_tasks", code: "unavailable" }`。即使全部 section 失败，也保持既有 `{ ok: true, sections: {}, errors }` 外层协议，不把传输执行成功当作业务查询成功。

`PurchaseAddressCoordinator` 继续只缓存和 stage 地址结果，非地址 section 透传对应筛选。单独查询 try_on_tasks 不读取地址或草稿，不 stage 卡片或表单；混合查询中仍允许原地址业务独立工作。

`createChatUserInformationTool()` 增加可选运行回调 `onTryOnTasksRequested`。schema 解析通过且 sections 包含 try_on_tasks 时，在第一个 await 之前调用回调，再执行 lookup。`ChatRecordsService` 在 PreparedChat 中维护本轮布尔标记，重复或并行调用只需置 true，不共享全局状态，不依赖模型结果正文猜测。

JSON 和 SSE 共用工具回调。查询失败同样保留该标记；仅查原三个 section 时不设置，避免扩大影响。

## 追踪、公开历史与记忆

### 运行事件与持久化副本

- 当前轮 ToolMessage 中只有上述安全元数据；模型读取结果后回答，原始实体从未进入图。
- `safeInformationArguments()` 增加 try_on_tasks 枚举和 tryOnStatus 白名单，同时对 page 限制 1–10；非法和嵌套 `invalid_tool_calls` 都走同一安全投影。
- `safeInformationProjection()` 新增第四类，只保存 itemCount、真实 total、合法 page 和固定 section 错误。任务条目、taskId、商品快照和任何图片信息不写入 trace 结果副本。
- 保留三类旧字段兼容；不得为了新投影覆盖正在执行的原始参数或供模型使用的安全结果。
- SSE activity 沿用工具名、执行状态与 null 输入输出，不发送原始 tool-call/tool-result；不新增公开事件或 publicDisplay 字段。
- 历史继续按已有隐藏工具集合成对过滤 `get_my_information`。assistant 最终安全摘要仍保存为正文，不能因此宣称聊天中不保存任务状态描述。

### 自动记忆与摘要来源

技术选择：只要本轮经校验调用过 try_on_tasks，无论成功、空列表或失败，该轮两条消息均不作为自动长期记忆及摘要来源。实现时在原购买 eligible 条件上额外加入 `!prepared.tryOnTasksRequested`。

消息、资格和最终展示绑定保持同一事务；eligible 为 false 时不登记记忆任务。复用来源读取器和 `eligibleSummaryTraceIds()`，验证混合批次、旧候选重试与失败/取消未绑定运行，不能只跳过当次 enqueue 而允许后续批次重新读入。

取舍：同轮同时表达的其他个人背景也会跳过自动提取，用户仍可手动维护记忆；下一轮普通聊天恢复原规则。不新增“把整轮文本交给模型后再删除部分任务事实”的提取路径，不修改历史消息资格或批量重写已有记忆。

这项整轮隔离已随首期技术方案获用户确认并接入，关联长期记忆契约和实际验证结果同步记录。

## 提示词与前端

更新现有工具 description、`system-context.md` 及必要的购物流程说明：明确当前用户主动查询时显式指定 try_on_tasks，“上次”为最新创建的未删除任务，失败不等于无记录，不估算时长，不评价未读取图片，不承诺下载成功。

`system-context.ts` 继续服务端读取并拼接既有 Markdown，不新增路由、分类器或按意图选择系统上下文。提示词测试同步更新，但不能用关键词断言代替真实工具链验证。

Web 沿用正文、工具 activity 和现有 `/account/try-ons` 页面；首期不增加前端状态、模板或自动跳转。现有页面继续重新读取资源并校验登录身份，不能从正文或任务引用构造图片 URL。

## 验证方案

以下为批准的验证要求；实际执行结果以实施文档记录为准。

| 层次          | 关键用例与实际证据                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| schema        | 三类默认值、显式四类、重复/未知 section、tryOnStatus 组合、数字字符串、0/11/小数、未知身份/资源/动作字段          |
| 领域查询      | 本人和他人、deleted 状态及 deletedAt、同时间分页、超过 5 条、空页、状态筛选、结果缺失/删除/他人结果及 read-only   |
| Service/工具  | 安全白名单、故障部分成功、全部失败、默认不读任务、回调早于 await 且失败也标记、地址转发互不污染                   |
| trace/history | 独立/嵌套/非法调用、结果白名单、无任务 ID 或图片信息、后续工具历史成对过滤、正文保留兼容                          |
| 记忆/摘要     | 整轮 false、无入队、混合批次/旧候选来源过滤、真实消息与 trace ID 绑定、下一普通轮恢复                             |
| 集成          | JWT + 现有 fake 模型 + 实际 ToolNode + 隔离 PostgreSQL，覆盖 JSON/SSE、模型收到安全结果、trace/公开历史及 401/404 |
| 浏览器        | 合成账号，桌面/窄屏询问最近任务、失败重试、账号/会话切换及进入原试穿页；不创建试穿或上传照片                      |

单元测试沿用所属模块 `spec/`。新增元数据 reader spec；schema、信息服务、地址协调器、trace、history、聊天服务、摘要及系统上下文在现有 spec 扩充。需要真实数据库的跨模块 HTTP 用例放在 `chat-records/spec/chat-try-on-information.postgres.spec.ts`，复用已有 fake 模型和 JWT 测试搭建方式，不能以直接 invoke 工具代替 HTTP 链路。

该新增套件拟使用 `RUN_CHAT_TRY_ON_INFORMATION_POSTGRES_TEST=1`、`CHAT_TRY_ON_INFORMATION_TEST_DB`，严格要求 `clothes_guide_chat_try_on_information_test_*` 且不等于默认库；必须显式注入 dbName。只迁移这个具名隔离库，准备 owner/stranger 合成任务和不访问存储的结果 fixture，关闭 Worker/定时器/供应商调用，串行执行并仅清理本套件数据。实施文档再固定具体库名和执行命令。

仅安装测试模块所需 provider，不启动完整应用 Worker；自动化不要求真实模型、对象存储或图像生成供应商。单元替身不能作为查询实际权限或 PostgreSQL 隔离级别的证明。

## 实施后验证命令

```bash
pnpm --filter @clothes-shopping-guide/api test
pnpm check
git diff --check
```

按现有验证约定串行运行共享构建输出的命令。另执行已审核目标库的门控集成测试，跳过项单独报告；不运行默认库 migration:fresh。全仓格式若被原有未改文件阻塞，只整理本次文件，再单独验证 typecheck/build 并如实报告。

代码实施后的业务测试、数据库和构建结果统一见[实施记录](./chat-tool-expansion-implementation.md)。

## 审批与退出条件

本技术文档及实施文档均已确认，首期按团队分工开发。文件所有权、隔离库、真实验收证据与剩余缺口见实施文档。

已确认的技术取舍是独立安全 reader、短只读一致性快照、整轮记忆/摘要隔离及上述验证边界。没有新增数据、外部授权或供应商接入决策；若实现必须扩大这些边界，回到相应设计和契约重新确认。
