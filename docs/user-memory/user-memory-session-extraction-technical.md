# 用户记忆会话批量提取技术文档

## 状态与审批边界

- 状态：已确认。
- 日期：2026-11-05。
- 已确认设计：[会话批量提取设计](./user-memory-session-extraction-design.md)及[用户记忆 CRUD 契约增补](../contracts/user-memory-crud-contract.md)。
- 确认记录：用户于 2026-11-05 回复“确认”，批准本文技术方案。
- 当前阶段：技术方案已确认并进入实施；交付记录见[实施文档](./user-memory-session-extraction-implementation.md)。
- 原完整拆分技术文档仍描述 2026-11-04 已实施方案；本文只覆盖本次提取频率变更，不回写已交付记录。

## 目标与约束

- 在同一用户、会话及文档 generation 内，将未领取且尚未生成候选的记忆来源轮次合并。
- 最后一轮消息持久化后延迟 5 分钟再领取；同会话新增消息会重置待处理批次的到期时间。
- 聊天页导航离开或切换会话时，仅提前释放尚未开始的待处理批次。
- 浏览器关闭时的 `pagehide` 通知尽力发送；服务器延迟领取是唯一可靠兜底。
- 不改变偏好领域、文档格式/存储、模型安全规则和当前上下文读取流程。
- 不增加依赖；继续使用 Vue Router、Axios、NestJS、Zod、MikroORM、PostgreSQL 和 node:test。

## 本地技术基线

| 能力     | 当前版本/实现                                     | 本次用法                                                                                                     |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 前端路由 | Vue Router `^4.5.0`                               | 在聊天页组合式逻辑注册 `onBeforeRouteLeave`；会话切换在 `selectConversation` 显式 flush                      |
| HTTP     | Axios `^1.20.0`，统一 `apiRequest`                | 通过现有 Bearer/刷新拦截器发送 flush；页面生命周期结束时使用 Fetch adapter `fetchOptions.keepalive` 尽力发送 |
| API      | NestJS `12.2.0`、全局 JWT Guard、`@CurrentUser()` | 在 user-memory 自有 Controller 加入认证 flush 路由                                                           |
| 校验     | Zod `^4.6.7`、Nest `StandardSchemaValidationPipe` | `z.strictObject({ conversationId: z.uuid() })` 并绑定 `@Body({ schema })`                                    |
| 数据     | MikroORM `7.2.5`、PostgreSQL                      | 复用事务、advisory lock、行锁、`SKIP LOCKED` 和 migration                                                    |
| 测试     | node:test、tsx、专用 PostgreSQL 测试库            | 复用现有 memory task/HTTP 测试模式，不安装新测试框架                                                         |

本次工作前已阅读对应本地实现、依赖版本及已安装调用模式。官方 API 核对：

- Vue Router Composition API 导航守卫：`https://router.vuejs.org/guide/advanced/composition-api.html`
- Axios Fetch adapter `fetchOptions`：`https://axios-http.com/docs/fetch_adapter`
- MikroORM v7.2.5 transactions / pessimistic locking：`https://github.com/mikro-orm/mikro-orm/tree/v7.2.5/docs/docs`
- Nest 参数校验采用仓库已安装的 `StandardSchemaValidationPipe`，不引入外部 Zod Pipe。

## 数据结构与迁移

只改记忆任务，不改 `user_memory_document_states`：

| 变化                             | 设计                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `user_memory_tasks.source_turns` | 新增 nullable `jsonb`；新任务保存 `{ userMessageId, assistantMessageId }[]`，历史行为不变的旧任务保持 null 并使用现有单轮字段           |
| 批次上限                         | 每个任务最多 10 轮；超过上限或遇到不可合并任务时新建待处理任务，来源不丢弃                                                              |
| 既有字段                         | `user_message_id`、`assistant_message_id`、`deduplication_key` 保留；旧行继续兼容，首轮 ID 保留在旧字段便于现有诊断及索引               |
| 现有候选                         | 已生成的 `candidate_operations` 不与新轮次合并或覆盖，仍按原租约重试                                                                    |
| Migration                        | 新增 migration 添加 nullable JSONB 列及适当 JSON 类型约束；历史行不回填、不改变状态、尝试次数、候选、租约、generation 或 `available_at` |

`source_turns` 只存消息 UUID，不存正文。来源内容仍由 `ChatExtractionSource` 在处理时读取，并逐项复查用户有效性、会话归属、消息归属和 user/assistant 角色。旧单轮任务继续走 `readTurn` 兼容路径；新批次通过公开只读端口新增 `readTurns`。

实现 migration 后必须审查生成 SQL 和 snapshot，并使用专用 PostgreSQL 库验证升级、实体 metadata、旧行兼容和 down 行为。不得对用户库执行 fresh；本地完整重建仅可使用此前已批准的 disposable database。

## 任务登记与合并

在 `UserMemoryTaskService.enqueueInTransaction` 中保持聊天外层事务和当前 `user-memory-document:<userId>` advisory xact lock：

1. 读取记忆设置及当前 `document_generation`；关闭时不登记。
2. 以 conversation、generation 查找尚未领取的 `pending` 任务，要求 `attempts = 0`、`candidate_operations IS NULL`、`source_turns` 未满 10 项。
3. 对候选行取得 `FOR UPDATE`。若本轮已包含在批次中则幂等返回；否则追加来源对，并使用数据库时钟重设 `available_at = now() + interval '5 minutes'`。
4. 若没有可合并任务，按现有 per-turn `deduplication_key` 创建新 `pending` 任务，`source_turns` 初始为单元素数组，`available_at` 同样设为数据库当前时间加 5 分钟。
5. 同一事务中若批次更新/插入失败，沿用既有 savepoint 错误隔离，不影响已保存聊天结果或偏好任务。

领取与登记通过数据库行锁竞争：登记先锁定 pending 行时，领取只能在其新到期时间后处理；领取先将任务改为 `processing` 时，登记不修改它，而创建新的 pending 批次。处理中的租约、候选和来源快照不可变。

## 调度、提取与重试

- 调度轮询间隔仍为 1 秒，批次领取上限仍为 10 个任务；每个被领取任务最多含 10 个来源轮次。
- 5 分钟不是定时器扫描阈值，而是 `available_at` 延后时间；PostgreSQL `now()` 同时用于登记和领取比较，避免应用时钟偏差。
- 提取器通过 `ChatExtractionSource.readTurns` 读取一批已授权消息对，并以有序数组传入模型。该只读能力仍归 `chat-records/extraction-source/` 所有，不由记忆模块直接查询聊天 Entity/Repository。系统指令明确只从用户明确表述中抽取长期信息，助手回复仅为理解语境，不作为用户事实来源。
- schema 与候选仍是单个任务的一组 `MemoryDocumentOperation[]`，保存前保持敏感检查和现有 JSON 校验。
- 候选保存与文档应用继续使用 `(taskId, attempts, lockedAt)` 租约及 document generation；重试复用原候选，不再次生成。
- 单批空候选正常标记成功并清除缓存；失败退避、最大尝试次数、安全日志和对象存储错误处理保持不变。
- 来源消息已删除、会话归属不符、账号失效或消息角色/关联不正确时，该任务不产出记忆。

## Flush API

| 项目       | 方案                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 方法和路径 | `POST /api/memories/tasks/flush`                                                                                                                    |
| 认证       | 现有 JWT Guard、`@CurrentUser()`；不接受 userId                                                                                                     |
| Body       | `z.strictObject({ conversationId: z.uuid() })`，额外字段返回 400                                                                                    |
| 权限       | 仅操作当前用户与 conversationId 匹配的任务；会话不存在或不属于当前用户返回 404                                                                      |
| 作用范围   | 仅将 `pending AND attempts = 0 AND candidate_operations IS NULL` 的任务 `available_at` 设为 DB `now()`；不改变 processing、已失败重试或已有候选任务 |
| 幂等性     | 无可提前领取任务仍返回 204                                                                                                                          |
| 错误       | 校验 400、未认证 401、会话不可见 404；数据库故障由现有异常映射处理                                                                                  |

Service 在修改前取得相同用户 advisory xact lock，并在一个短事务里验证当前用户对会话的所有权、更新符合条件的任务。flush 不等待模型调用、不直接提取，也不影响下一轮对 pending 批次的合并；任务一旦被 scheduler 领取，flush 不撤销租约。

## 前端触发

- 将 `flushMemoryTasks(token, conversationId)` 放在 `apps/web/src/api/modules/chat.ts` 或独立的 memories API module 之前，需按最终 API 归属统一放在 `src/api/modules/memories.ts`，不在页面直接调用 Axios。
- `useChatPage()` 内统一封装非阻塞 `flushActiveConversation(id)`，从 `selectConversation` / `startNewConversation` 切换离开的旧会话时触发。
- 页面组件/页面组合式函数通过 Vue Router `onBeforeRouteLeave` 对离开 `/chat` 触发同一调用。导航不因请求失败被取消，不等待后台模型完成。
- 在 `pagehide` 上尝试一次 `apiRequest` + Fetch adapter `fetchOptions: { keepalive: true }`，并关闭刷新重试；只作浏览器关闭或刷新补充，不能作为必要条件。`visibilitychange` 不触发，避免切换浏览器标签时提前结束聊天批次。
- `pagehide` 与路由守卫可能重复触发，API 幂等即可；页面卸载时清理事件监听器。
- 登录 token 不存在时跳过触发；401 或网络错误不得重定向/阻塞卸载，普通路由守卫时由统一 Axios 认证逻辑处理并仅记录安全失败。

## 模块边界与文件范围

### API

- `apps/api/src/user-memory/entity/user-memory-task.entity.ts`
- `apps/api/src/user-memory/port/user-memory.port.ts`
- `apps/api/src/chat-records/extraction-source/chat-extraction-source.port.ts`
- `apps/api/src/chat-records/extraction-source/chat-extraction-source.service.ts`
- `apps/api/src/user-memory/service/user-memory-task.service.ts`
- `apps/api/src/user-memory/service/user-memory-extractor.service.ts`
- `apps/api/src/user-memory/controller/` 与 `dto/`
- `apps/api/src/user-memory/user-memory.module.ts`
- `apps/api/src/user-memory/spec/`
- `apps/api/src/database/migrations/` 与生成 snapshot

### Web

- `apps/web/src/api/modules/memories.ts`
- `apps/web/src/pages/chat/page.ts`
- 如离页守卫需页面实例，最小修改 `apps/web/src/pages/chat/index.vue`，不抽到全局 Store。

不新增共享队列框架或第三方库；记忆领域新增公开端口只提供该能力必须的窄接口，Controller/Service 不跨模块访问聊天私有 Entity/Repository。

## 测试设计

### API 单元/组件测试

- Zod schema 接受合法 UUID、拒绝非 UUID 和额外字段；真实 Nest HTTP 校验映射为 400。
- flush 只操作当前用户的待处理、零尝试、无候选任务；错误用户返回 404；无任务/重复调用 204。
- 模型输入顺序稳定，助手文本不被作为事实；越权/缺失来源不调用模型。
- 旧任务 `source_turns = null` 仍按单轮处理；新任务 array source 按批读取。

### PostgreSQL 任务测试

- 连续 enqueue 合并到同一任务并将到期时间重置为 DB now + 5 分钟。
- 达到 10 轮后新建批次；重复来源不添加两次。
- 5 分钟未到不可领取，时限到达后可领取；flush 仅将可提前任务设为 now。
- enqueue 与 claim 竞争时，只出现“原批次被更新”或“后续 pending 批次”之一，不丢消息、不覆盖 processing lease。
- 已有候选的 failed 任务不被合并或修改；重试不增加模型调用。
- 开关关闭、文档清空/generation 递增、任务 lease 过期、来源会话删除行为保持隔离。
- migration 夹具确认旧任务列值、候选、attempts、status、locked_at 和 generation 无损保留。
- 删除会话后，其批次来源校验失败，不应用候选；不删除已形成的 Markdown 记忆文档。

### Web 验证

- 页面测试设施未安装，按仓库约定不新增测试框架或脚本。
- 使用现有浏览器/临时 harness 验证离开聊天页、切换会话、开始新会话、页面关闭、重复触发、无 token、请求 401/网络失败和聊天流仍在生成时的行为。
- 重点确认导航不会被 flush 网络请求阻塞或取消生成期间引入状态覆盖；当前聊天流断开后的既有状态处理保持原样。

## 风险与停止条件

- 合并任务和新接口都涉及 API/数据库，必须新增 Migration 并对部署顺序做测试；不能只改 `available_at`，否则仍会逐轮调用模型。
- 页面离开触发可能与刚完成聊天事务并发；flush 只提前已存在的 pending 任务。下一轮若正在提交，enqueue 按正常 5 分钟调度，不保证收到此前 flush。
- 浏览器在刷新、关闭、崩溃、移动端切换或进程回收时可能不派发/不完成 pagehide 请求；只要服务端延迟任务仍有效即可恢复。
- 若批次来源序列化、历史 null 兼容或任务并发方案需要扩大到跨领域任务框架，停止并更新设计审批范围。
- 不在实施阶段对用户数据库运行 `migration:fresh`；历史升级验证使用专用 disposable DB。

## 确认记录

- 用户于 2026-11-05 回复“确认”，批准新增 `source_turns jsonb`、每批最多 10 轮、数据库时间 5 分钟去抖、pending 零尝试任务可由 flush 提前、Axios `keepalive` 仅作浏览器关闭最佳努力，以及保持失败重试候选不可变。
- 下一阶段为[实施文档](./user-memory-session-extraction-implementation.md)，其获确认前不改代码、Entity、Migration、DTO、Controller、测试或配置。
