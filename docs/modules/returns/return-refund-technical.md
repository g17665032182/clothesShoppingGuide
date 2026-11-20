# 退货退款技术文档

## 状态与依据

- 状态：已确认。
- 依据：[退货退款设计](./return-refund-design.md)、[CRUD 契约](../../contracts/return-refund-crud-contract.md)、[订单契约](../../contracts/order-crud-contract.md)。
- 当前实现：首版代码已实现；数据库迁移及登录态浏览器验收未执行。本技术文档记录原技术方案，实际状态以实施记录为准。
- 技术栈：沿用 API NestJS 12、MikroORM 7、PostgreSQL、Zod 4、原生 ESM；Web 沿用 Vue 3、Pinia、Axios。
- 最后更新：2026-11-20。

## 实现目标

- 新增内聚的 `return-refund` 售后模块，管理申请、商品项、凭证元数据和状态审计。
- 订单领域通过公开只读 Port 提供本人订单/商品项快照；售后模块不得依赖订单私有 Repository 或 Entity。
- 用户订单页可独立创建并提交售后申请，也可继续聊天工具创建的待补充申请。
- 大模型创建申请必须通过本轮注册的售后工具；工具成功后只创建 `pending_user_submission`。普通模型文本、Markdown、前端解析、工具 activity 或伪造参数都不能创建申请。
- 真实退款不接入；管理员“已退款”是本站状态登记。
- 日期资格使用 API 依赖 `date-fns` 与 `@date-fns/tz` 按 `Asia/Shanghai` 日历日计算；文件证据复用已安装的 `qiniu` SDK，并通过售后模块自有 Port/适配器，不依赖试穿模块私有实现。

## 包与目录结构

```text
apps/api/src/return-refund/
  index.ts
  return-refund.module.ts
  controller/
    return-refund.controller.ts
    admin-return-refund.controller.ts
    return-refund-evidence.controller.ts
  service/
    return-refund.service.ts
    return-refund-query.service.ts
    return-refund-evidence.service.ts
    return-refund-audit.service.ts
  entity/
    return-refund-application.entity.ts
    return-refund-item.entity.ts
    return-refund-evidence.entity.ts
    return-refund-event.entity.ts
  dto/
    return-refund-*.dto.ts
  port/
    order-return-refund-reader.port.ts
    return-refund-evidence-store.port.ts
  storage/
    qiniu-return-refund-evidence-store.service.ts
  spec/
    *.spec.ts

apps/web/src/
  api/modules/return-refund.ts
  api/types/return-refund.ts
  pages/account/orders/       # 订单详情/申请页集成
  pages/admin-return-refunds/ # 新增管理员售后审核页
```

实施时根据现有 Web 页面组织复用 `pages/account/orders/` 的页面/组件，不另造一套订单列表或表单基础设施。

## 依赖与复用

- API 使用现有 Nest `StandardSchemaValidationPipe`、Zod strict schema、JWT 当前用户、`RolesGuard` 和 `UserRole.ADMIN`。
- 持久化使用现有 MikroORM/PostgreSQL 与增量 Migration；不引入状态机库，状态转换在售后 Service 内集中实现。
- 金额使用 PostgreSQL `numeric` 与现有金额字符串约定；服务端按订单明细快照计算。
- 文件凭证不复用试穿照片 Entity、限定测试图片逻辑或 `TRY_ON_*` 配置。售后 Evidence Store 使用独立对象前缀与 `RETURN_REFUND_*` 配置；适配器可复用已安装七牛 SDK。开发可用私有本地适配器，但不得挂静态目录。
- 支持 JPG/PNG/WebP 图片和 MP4 视频；图片每份最大 10 MiB、视频每份最大 50 MiB、每个申请最多 5 份。文件保持私有，不向普通响应、日志、trace 或模型提供对象 URL。

## 模块接口和依赖注入

### 售后模块公开接口

- `ReturnRefundService.createDraftFromChat(userId, input, idempotencyKey)`：供聊天工具调用，验证本人订单及明细，创建 `pending_user_submission`。
- `ReturnRefundService.createAndSubmitForUser(userId, orderId, input, idempotencyKey)`：供用户订单页直接创建，成功进入 `pending_review`。
- `ReturnRefundService.submitDraft(userId, applicationId, version)`：提交聊天创建的申请并计算人工审核标记。
- `ReturnRefundQueryService.listForUser/getForUser/listForAdmin/getForAdmin`：按身份范围查询并投影。
- 状态动作由单一领域 Service 暴露专用方法：取消、审核通过/拒绝、寄回登记、确认收货、登记验货后退款处理中、登记退款完成；不暴露任意目标状态更新方法。

### 订单读取 Port

`OrderReturnRefundReaderPort` 由订单模块实现并导出公开 token。返回只读快照：

- 订单 ID、orderNo、当前状态、`completedAt`、币种。
- 订单明细稳定 ID、商品名、外部商品标识、颜色/尺码、图片 URL、购买数量、单价快照。
- 读取必须按当前用户绑定；不返回 recipient、phone、address、shipment 或其他敏感字段。

当前订单 API 详情不暴露订单明细主键；不得把 SKU ID 当成订单行 ID。新增订单 Port 内部查询并返回 `OrderItem.id`，聊天工具和订单售后 API 使用此标识。

### 聊天工具

每轮聊天注册只读和写工具：

- `list_my_return_refund_orders`：严格空对象输入，返回当前用户有限订单候选及状态/完成时间摘要，不返回完整收件信息。
- `get_my_return_refund_items`：按本人订单 ID 读取商品行、可申请数量和快照单价，不接收 `userId`。
- `create_return_refund_application`：接收订单 ID、明细 ID/数量、退货原因；仅在本轮用户明确确认完整摘要后由模型调用。调用售后 Service 创建 `pending_user_submission`，不替用户正式提交。

工具 factory 只接受 `ReturnRefundService`/reader Port 和聊天服务端绑定的 userId；严禁从模型参数接收 userId。注册工具后，调用成功、空结果及失败均把本轮标为 detail query，不进入自动长期记忆/摘要来源。Trace 按工具名做白名单投影：只记录工具名、行数、状态和固定枚举；原因文本、参数对象、用户输入和附件数据不写入 trace/activity。历史恢复隐藏工具调用原文和结果，公开聊天正文不从工具结果构造申请操作按钮。

工具层只能限制“创建申请必须经过工具入口”，不能独自证明模型是否正确理解了用户同意。服务端仍校验已登记的订单/商品快照、请求严格 schema、幂等和身份；用户确认时序由系统上下文与工具描述约束，具体确认证据若需密码学/服务端强保证属于本阶段待确认项。

## 数据模型与事务

### Entity

- `ReturnRefundApplication`：订单、用户、状态、人工审核标记/原因、用户原因、固定退款金额/币种、拒绝原因、退货承运商/单号、版本号及主要时间戳。
- `ReturnRefundItem`：售后申请、订单项 ID、订单商品快照、申请数量、快照单价、行金额。
- `ReturnRefundEvidence`：申请 ID、对象键、校验 MIME、字节数、摘要、创建/删除时间；不存储公开 URL。
- `ReturnRefundEvent`：申请 ID、动作类型、操作者角色/ID、前后状态、时间及必要的安全审计元数据；避免复制凭证或完整地址/物流信息。

实体字段、索引、外键由实施阶段形成 Migration。申请保留订单和商品快照，订单项主键使用稳定 UUID。退货物流写入售后资源，不覆盖原订单发货快照。

### 原子性和锁

- 订单创建/申请动作以当前订单行作为串行化锁点；事务内重新读取订单状态、完成时间和订单项，再做数量与申请状态校验。
- 同一订单最多一条活动申请，以数据库部分唯一索引保证；活动状态排除 `rejected`、`cancelled`、`refunded`。唯一冲突映射为 409。
- 创建申请时用数据库锁/原子序列化防止两个并发请求同时超量申请。退款完成时在同一事务内锁定订单、申请和申请项，更新状态并写审计事件。
- 已退款数量通过同订单项所有 `refunded` 申请项聚合。申请时约束 `requested quantity + refunded quantity <= ordered quantity`；现有进行中申请由订单唯一活动申请约束覆盖。
- 退款金额由 `unitPriceSnapshot * quantity` 使用精确十进制/整数分运算计算；不接收金额参数，不把运费、折扣或运费分摊计入退款。
- 所有状态动作使用“期望当前状态 + 目标专用动作”的事务更新；更新行数为零时重新读取并返回 409，禁止 lost update。
- 聊天工具调用使用一次确认调用的幂等键。键需绑定 `userId + conversationId + toolCallId` 并设唯一约束；相同键相同规范化请求返回原申请，不同参数返回 409。是否将幂等记录独立建表或收敛在申请字段，实施时择最简方案。

### 7 日资格标记

`completedAt` 缺失、订单非 `completed` 或时间资格无法判定时，正式提交仍可继续，但设置 `manualReviewRequired=true` 及服务端原因码。资格按 `Asia/Shanghai` 自然日计算：确认收货当天为第 1 天，第 7 天 `23:59:59.999` 截止且包含该瞬间；此后进入人工审核。判定使用服务端可信时钟，将完成时间和当前时间转换为北京时间日期后比较，不依赖数据库 Session 或主机本地时区。

## API 设计

全部 API 位于 `/api`，复用 Bearer JWT。下方为拟定路由，所有请求对象严格拒绝未知字段；Body/Query/Param 分别使用 DTO 目录 Zod schema 并由 `@Body({ schema })` 等绑定现有全局 Pipe。

### 用户订单页 API

| 方法/路由                                                     | 输入                                              | 行为                                                        |
| ------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `GET /orders/:orderId/return-refund-options`                  | Param `orderId`                                   | 返回本人订单商品、数量余额、规则初筛提示；不含收件/物流快照 |
| `POST /orders/:orderId/return-refund-applications`            | Param；Body `items[]`、`reason`、`idempotencyKey` | 订单页独立创建并直接提交为 `pending_review`                 |
| `GET /return-refund-applications`                             | Query `page`、`pageSize`、可选 `status`           | 分页列出本人申请                                            |
| `GET /return-refund-applications/:id`                         | Param                                             | 读取本人申请安全详情                                        |
| `POST /return-refund-applications/:id/submit`                 | Param；Body `version`                             | 提交聊天创建的待补充申请                                    |
| `POST /return-refund-applications/:id/cancel`                 | Param；Body `{}`                                  | 本人仅在 `pending_user_submission` / `pending_review` 取消  |
| `POST /return-refund-applications/:id/evidence`               | Param；multipart `file`                           | 上传可选凭证，校验归属与文件内容                            |
| `DELETE /return-refund-applications/:id/evidence/:evidenceId` | Param                                             | 本人删除申请尚在允许范围内的凭证及其对象                    |
| `GET /return-refund-applications/:id/evidence/:evidenceId`    | Param                                             | 本人认证后下载私有凭证，不返回签名 URL                      |
| `POST /return-refund-applications/:id/return-shipment`        | Param；Body `carrier`、`trackingNo`               | 审核通过后登记一组退货物流并转到 `returned_by_user`         |

聊天工具不调用公开 HTTP API，而是调用模块公开 Service/Port，避免 API key/JWT 回环或绕过服务端聊天身份。

### 管理员 API

统一前缀 `/admin/return-refund-applications`，Controller 使用既有 `RolesGuard` 和 `UserRole.ADMIN`：

| 方法/路由                                                        | 输入                                                  | 行为                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `GET /admin/return-refund-applications`                          | Query `page`、`pageSize`、状态、人工审核标记、orderNo | 分页检索                                                                  |
| `GET /admin/return-refund-applications/:id`                      | Param                                                 | 读取管理详情和凭证元数据                                                  |
| `GET /admin/return-refund-applications/:id/evidence/:evidenceId` | Param                                                 | 管理员认证后下载私有凭证，不返回签名 URL                                  |
| `POST /:id/approve`                                              | Body `version`                                        | `pending_review` -> `approved_pending_return`                             |
| `POST /:id/reject`                                               | Body `version`、`reason`                              | `pending_review` -> `rejected`                                            |
| `POST /:id/received`                                             | Body `version`                                        | `returned_by_user` -> `pending_inspection`                                |
| `POST /:id/refund-processing`                                    | Body `version`                                        | `pending_inspection` -> `refund_processing`                               |
| `POST /:id/refunded`                                             | Body `version`                                        | `refund_processing` -> `refunded`；金额只能读取固定申请额，不允许提交金额 |

管理端每个写动作记录管理员 ID/角色和状态事件；不能提供任意 `status` Patch。

## Zod Schema、输入类型与错误映射

DTO 文件均位于 `apps/api/src/return-refund/dto/`。命名如下，实际字段依据前述 API 固定；类型从 schema 导出，必要时分别导出 `z.input` 和 `z.output`。

| 位置                                                     | Schema                                                           | 规则                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /orders/:orderId/return-refund-applications` Param | `returnRefundOrderIdSchema`                                      | 严格对象，仅 UUID `orderId`                                                                                                                |
| 同路由 Body                                              | `createAndSubmitReturnRefundSchema`                              | 严格对象：1–50 项 `{ orderItemId, quantity }`、trim 后 1–1000 字符 reason、UUID idempotencyKey；数量正整数；拒绝金额、用户、状态等未知字段 |
| `GET /orders/:orderId/return-refund-options` Param       | `returnRefundOrderIdSchema`                                      | 同上                                                                                                                                       |
| `GET /return-refund-applications` Query                  | `returnRefundUserQuerySchema`                                    | 严格对象；page/pageSize 接口按现有模式由十进制整数 Query 字符串转换，默认 1/20、pageSize 最大 100；status 严格枚举                         |
| `POST /:id/submit` Body                                  | `submitReturnRefundSchema`                                       | 严格对象，仅正整数 `version`                                                                                                               |
| 用户/管理员单资源 Param                                  | `returnRefundApplicationIdSchema`                                | 严格对象，仅 UUID `id`                                                                                                                     |
| 取消 Body                                                | `emptyReturnRefundActionSchema`                                  | 严格空对象                                                                                                                                 |
| 退货物流 Body                                            | `returnRefundShipmentSchema`                                     | 严格对象；carrier/ trackingNo trim 后 1–100 字符，不接受控制字符                                                                           |
| 管理员列表 Query                                         | `adminReturnRefundQuerySchema`                                   | 严格对象；分页、状态枚举、可选人工标记、orderNo trim 后 1–100 字符                                                                         |
| 管理员状态动作 Body                                      | 对应 `approve/reject/received/refund-processing/refunded` schema | 各动作严格定义 version；拒绝额外必填 reason，其他动作拒绝额外字段；不接受目标状态/金额                                                     |
| 凭证 multipart Body                                      | `returnRefundEvidenceMetadataSchema`                             | metadata 仅严格空对象；JPG/PNG/WebP 图片最多 10 MiB，MP4 最多 50 MiB；每申请最多 5 份；由 service 检查文件内容，不信任客户端 MIME          |

所有未知字段或 Zod 校验失败由 `StandardSchemaValidationPipe` 映射为 HTTP 400；资源归属由服务层返回 404，状态冲突/唯一冲突返回 409。Swagger DTO 只描述 OpenAPI，不重复运行时校验。

## 文件凭证安全

- 独立 `RETURN_REFUND_EVIDENCE_STORE` Port 与七牛适配器；bucket、key prefix、凭据复用现有 Qiniu 配置来源，但 key 前缀固定为 `return-refund/<userId>/<applicationId>/<evidenceId>.<ext>`，从不接收用户自定义 key。
- 上传前校验扩展名、MIME 与文件签名一致，拒绝 SVG、HTML、可执行文件、空文件、过大文件；文件始终私有，下载通过认证 Controller 流式返回并再次核对申请归属/管理员角色，不向普通 JSON 或模型提供签名 URL。
- 数据库写 metadata；对象失败不留下可访问记录。删除使用墓碑/可重试清理，不能把私有对象路径或存储错误泄露给客户端。
- 上传对象不设置独立公开地址；用户可在待用户提交/待审核阶段删除附件，用户和管理员下载均经认证并核验申请归属。首期不设置终态后的自动保留清理，附件随售后记录保留。

## 前端组织

- 本人订单详情增加“申请退货退款”入口：请求售后选项，选择部分明细和数量，填写原因，确认金额后提交；提交后显示申请状态、可选凭证、取消/物流操作。
- 在本人订单页增加售后申请列表/详情入口，聊天创建的待用户提交申请与订单页独立提交申请共用详情视图。
- 管理员新建售后申请列表和详情页面，支持筛选、审核通过/拒绝、确认收到、退款处理中与完成登记；拒绝原因使用表单输入，退款金额只读展示。
- 使用现有 Axios API 底座、认证和 Toast。身份切换时清空异步请求/页面状态；提交状态采用 loading/unknown/error 保护，不因超时假报成功。当前仓库无前端测试框架，按既有 typecheck/build 和获准的手工交互验收。

## 安全与可观测性

- 每个用户 API 与模块服务都从认证上下文绑定 userId；订单 Port 再核验归属。管理员写 API 使用角色 Guard。
- 所有创建及动作均服务端重新读取资源；禁止信任模型上下文、页面余额、旧申请卡片或客户端金额。
- 申请原因可含个人信息；模型工具执行 trace/activity 仅保存安全白名单。凭证内容、对象键、地址、手机号、完整退货单号和管理员私有内容不进入聊天上下文、历史投影、日志。
- 管理员审计记录操作者、动作、状态和时间；不复制文件数据或无关收件快照。
- 真实退款外部系统尚无集成；所有 UI 和响应明确显示“本站登记状态”，避免把状态值包装成资金凭证。

## 测试方案

- Schema 单测：合法/非法 UUID、空原因、未知字段、整数数量、超范围分页、严格空对象、物流边界和管理员动作输入。
- Service 单测：本人隔离、订单状态及 7 日边界、手工审核路径、固定金额、重复/并发创建、部分数量累计、每个状态转换、拒绝/取消后重开和幂等。
- 隔离 PostgreSQL 测试：部分唯一索引、并发活动申请、同订单项数量竞争、退款登记重试、事务回滚、迁移升级/回滚/再升级。
- 聊天工具/trace/history 单测：只有工具创建；schema 与身份绑定；显式确认流程；不泄漏原因、凭证、物流和内部结果；JSON/SSE 装配一致；detail-query memory/summary exclusion。
- HTTP 测试：用户与管理员访问控制、订单/明细越权、404/409/400、附件类型/大小/归属/删除、签名 URL 不外泄。
- Web 手工覆盖直接申请、聊天草稿继续提交、可选附件、管理员审核与各状态；不得调用真实付款/退款。

## 风险与限制

- 凭证首期只支持 JPG/PNG/WebP 图片和 MP4 视频，超出类型/大小/数量拒绝；订单页显式提交作为直接申请确认。
- 助手路径必须先聊天明确确认再调用已注册工具；服务端能证明工具写入来源与幂等，但不能独立证明模型是否正确理解自然语言同意。
- “pending review”内部人工审核标记原因码需固定枚举，实施前按确认范围确定。
- Qiniu 复用配置必须验证环境隔离和 key 前缀；若部署环境不允许共用现有 bucket/config，需在实施文档调整为独立配置。

## 验证命令

实现阶段预期执行：`pnpm format:check`、API `typecheck`、API `test`、API `build`、Web `typecheck`/`build`、`pnpm check`、`git diff --check`，并使用项目认可的具名隔离 PostgreSQL 验证 Migration。当前技术文档阶段不运行实现验证、不连接或迁移数据库，也不执行 `migration:fresh`。
