# 用户偏好 CRUD 契约

## 状态与上下文

- 状态：完整拆分文档已确认，已实施并完成受控验收。
- 最后更新：2026-11-04。
- 需求：用户要求偏好与记忆“所有的都拆开”。
- 模块：`apps/api/src/user-preferences/`。
- 设计：[完整拆分设计](../user-memory/user-preference-memory-separation-design.md)。
- 关联资源：[用户记忆契约](./user-memory-crud-contract.md)。
- 确认记录：2026-11-04 用户批准设计、本契约、技术文档，并回复“确认实施文档”授权实施；接口已切换。

## 后续变更：用户维护结构化偏好

- 状态：设计、契约、技术方案和实施文档已确认，代码已实施；数据库集成测试及上线切换待完成。详见[实施记录](../user-memory/user-memory-background-implementation.md)。
- 用户本人通过现有偏好管理功能新增、修改和删除结构化偏好；LLM 只可在聊天时读取并参考，不得自动写入。
- 保留已有偏好及其归属、内容和来源；现有偏好 CRUD 与权限不变。
- 不再产生新的自动偏好任务；未完成或在途旧任务停止写入，历史任务保留。偏好开关只控制聊天注入，关闭不删除偏好或阻止手动管理。
- 实施前须明确并验证并发边界，保证新规则生效后旧任务不能写入；不得影响独立的 Markdown 记忆任务。

## 资源与字段

用户偏好是结构化服装与购物信息，独立于 Markdown 文档。

| 字段                     | 约束                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `id`                     | 服务端生成的 UUID                                                                    |
| `category`               | size、shoe_size、fit、style、color、occasion、budget、avoidance、purchase_preference |
| `valueType`              | 按类别派生的 single、multi 或 range                                                  |
| `value`                  | 按类别校验的 JSON                                                                    |
| `isPrimary`              | 布尔值，创建默认 false；保留现有主偏好规则                                           |
| `source`                 | 来源会话及 active/deleted/unavailable 状态，或 null                                  |
| `createdAt`、`updatedAt` | ISO 8601 字符串                                                                      |
| `userId`                 | 仅由认证上下文确定                                                                   |
| 指纹、删除状态、任务字段 | 内部字段，不直接返回 Entity                                                          |

### 值校验

- 风格、场景、购买偏好 items 为 trim 后 1–32 字符非空短文本，禁止控制字符；风格和场景最多 5 项，购买偏好最多 6 项。
- 颜色及避开内容最多 8 项；版型说明及避开原因最多 80 字符。
- 服装类型、尺码标签/体系、鞋码体系、鞋宽、版型支持 1–32 字符短文本；原稳定代码和自定义值继续接受。
- 鞋码为 20–60 数值；预算为非负整数，至少一个边界，最小值不大于最大值，货币 CNY/USD。
- 创建按类别判别；更新至少一个字段，值与更新后的类别匹配。
- 拒绝敏感信息，不回显命中片段；保留现有去重、主偏好和多值合并规则。

## 已确认 API

| 操作     | 方法及路径                        | 输入与响应                                                                      |
| -------- | --------------------------------- | ------------------------------------------------------------------------------- |
| 查询     | `GET /api/preferences`            | page 默认 1，pageSize 默认 20、最大 100，可选 category；返回分页及偏好 settings |
| 创建     | `POST /api/preferences`           | category、value、可选 isPrimary；`201`，重复创建沿用复用行为                    |
| 修改     | `PATCH /api/preferences/:id`      | UUID，至少一个可更新字段；返回偏好                                              |
| 删除单条 | `DELETE /api/preferences/:id`     | 逻辑删除，成功 `204`                                                            |
| 删除全部 | `DELETE /api/preferences`         | `{ confirm: true }`；返回 `{ deletedCount }`                                    |
| 读取开关 | `GET /api/preferences/settings`   | `{ enabled, updatedAt }`                                                        |
| 修改开关 | `PATCH /api/preferences/settings` | `{ enabled: boolean }`；返回偏好设置                                            |

移除旧结构化 `/api/memories` 与 `/api/memories/:id` 路由，不保留混用名称的别名。前端同步更新。settings 静态路由不得被动态 UUID 路由截获。

Body/Query/Param 使用 Zod 和 Nest 标准校验 Pipe。对象拒绝未知字段，Query 数值转换及默认值保留。类型从 schema 派生，Swagger DTO 仅用于文档。

## 权限与错误

- 仅登录用户本人，复用 JWT 和当前用户机制，不新增管理员旁路。
- 未登录 `401`；非法字段、未知字段、值越界、无变更字段或敏感值 `400`。
- 不存在或非本人资源统一 `404`。
- 修改为同类重复内容保持当前 `400`；重复创建复用相同记录。
- 数据库异常沿用全局映射，不暴露 SQL、Entity 或凭据。

## 独立设置与任务

- enabled 默认 true，只控制偏好提取与注入；关闭不删除数据或禁止手动 CRUD。
- 不读写记忆开关；任务开始和提交前复查本领域设置。
- 独立任务表、调度器、重试、提示、schema、模型调用和操作幂等结果。
- 任务不加载文档，不依赖七牛服务或文档 generation。
- 聊天通过公开入口在持久化事务中登记，任务去重、批次领取、恢复和最大重试独立维护。
- 任务执行需核对用户有效性、消息与会话归属；部分成功后的重试不重复应用。
- 删除全部只取消本领域未完成任务及在途写回，不取消记忆任务。
- 单条逻辑删除沿用现有语义；来源会话删除只更新偏好来源状态。
- 本次不新增账号物理删除接口；未来账号物理删除由本领域清理自身资源。

## 已确认数据与迁移范围

- 表：user_preferences、user_preference_settings、user_preference_tasks、user_preference_task_results。
- 原 user_memories 和结构化结果迁入偏好命名，保留 ID、归属、值、来源、状态与幂等关系。
- 原共用设置原值初始化偏好设置，不能重新开启已关闭用户。
- 原共用任务转换为独立偏好任务，保留已完成操作，不重新执行成功更新。
- 偏好任务不关联记忆任务或文档 generation。
- 已新增并审阅 `Migration20261104090000`，历史数据、危险部分结果回滚及并发恢复已通过专用 PostgreSQL 验证。
- 本地已执行确认的 `pnpm migration:fresh`，完整重建并自动 Seed；结果见拆分实施文档。

## 验收

- [x] 类别、预设、自定义、严格字段和边界校验保持。
- [x] CRUD、去重、主偏好、多值合并、来源状态及权限正确。
- [x] 新路由、分页转换/默认值、未知字段和 HTTP 错误有验证。
- [x] 独立设置与任务不依赖记忆；记忆故障不阻断偏好。
- [x] 删除全部与在途任务互斥，不影响记忆。
- [x] 历史数据和任务转换保持幂等。
- [x] 前端偏好 API、类型和独立开关已适配。

## 已确认增量：聊天本人偏好明细查询

- 日期：2026-11-16；状态：第二阶段设计、契约、技术及实施均已确认，工具已接入；验证与缺口见第二阶段实施记录。
- 依据：[第二阶段设计](../llm/chat-tool-phase-two-design.md)及[扩展增量契约](./chat-tool-expansion-crud-contract.md)。
- 增加只读模型工具 get_my_preferences，仅用于用户明确查询已保存明细；普通推荐继续使用现有相关性注入。类别沿用九类，每页固定 5 条，页码实际整数 1–10，拒绝模型指定归属、页大小、动作和未知字段。
- 只查询本人 active 且 deletedAt 为 null 的记录，先类别过滤，按 isPrimary 倒序、updatedAt 倒序、内部 ID 升序分页，返回真实总数和 hasNext；不使用相关性摘要代替完整列表。
- 结果只含 category、valueType、经既有类别和安全规则重新验证的 value、isPrimary、updatedAt。不返回 ID、来源、指纹、任务或记忆文档；非法存量值导致 unavailable，不静默漏项。
- **已确认规则**：偏好 enabled 关闭时，不读取或返回偏好值，固定返回 preferences_disabled；这扩展了原开关“只控制聊天注入”的含义。关闭不删除数据，不影响本人管理 API，也不使用独立记忆开关控制此工具。
- 设置缺行按默认 true 解释但不补建记录，读取不调用可能写入的设置初始化路径，不恢复旧自动偏好任务。开关与结果按同次一致读取处理；新查询重新读取状态，旧聊天正文不撤回。
- 不新增写权限、HTTP 路由、数据字段或迁移。已确认的整轮记忆/摘要来源隔离另见[记忆契约](./user-memory-crud-contract.md)，不得将明细回显当作用户新偏好；接口和查询方案见[第二阶段技术文档](../llm/chat-tool-phase-two-technical.md)，分工及实际验证见[实施记录](../llm/chat-tool-phase-two-implementation.md)。
