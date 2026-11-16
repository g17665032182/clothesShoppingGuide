# 聊天用户信息查询实施文档

## 状态与依据

- 状态：用户已于 2026-11-13 确认；代码实现及自动化验证完成，登录态浏览器验收未执行。
- 依据：[用户信息查询设计](./chat-user-information-design.md)、[CRUD 契约](../../contracts/chat-user-information-crud-contract.md)、[技术文档](./chat-user-information-technical.md)。
- 关联变更：[聊天卡片展示](../chat-card-display/chat-card-display-design.md)、[动态表单](../chat-dynamic-form/chat-dynamic-form-design.md)、[购买流程](../chat-purchase/chat-purchase-design.md)、[用户地址](../user-addresses/user-addresses-design.md)。
- 所属应用：`apps/api`、`apps/web`。
- 最后更新：2026-11-13。

## 实际交付记录（2026-11-13）

- 新增 `get_my_information`，按当前聊天认证上下文查询本人地址、订单与已保存图片元数据；各 section 独立故障处理并执行安全字段投影。
- 下单草稿缺收件信息时，地址查询和 `purchase_recipient` 动态表单共用请求级协调器：地址非空时只展示 `address_selection`；查询成功为空时才允许收件表单；查询失败不会当作空列表，用户明确选择手动填写后可继续。
- 地址选择卡只保存草稿 ID/版本；前端组件局部加载本人地址，不预选默认地址；用户点击确认后经认证购买 API 写入草稿。旧 `list_my_shipping_addresses` 与 `select_my_shipping_address` 不再注册为模型工具，旧 trace/history 仅保留安全兼容。
- 保留 `purchase_recipient` 表单原有 SKU/数量字段能力；本次地址簿 gate 只拦截包含收件字段的表单请求，避免影响非收件字段的表单用途。
- 地址详情不进入模型工具结果、trace/activity、公开历史或 Pinia；新卡片只包含草稿引用。未新增 Entity、Migration 或运行时依赖。
- 子代理报告：领域代理完成信息查询与图片元数据公开 Port；聊天/购买代理完成工具注册、地址分支、trace/history 和选择 API；Web 代理完成地址选择卡及 API/Store 接线。主代理执行集成复核并补回归保护。
- 验证：API 全量测试 320 项中 305 通过、15 个数据库门控用例跳过、0 失败；地址分支/动态表单定向测试 30/30 通过；API 与 Web 类型检查、API 与 Web build、受影响文件 Prettier 检查及 `git diff --check` 均通过。
- `pnpm check` 被两份未修改文档的既有格式问题阻断：`docs/modules/chat-purchase/chat-purchase-prd.md` 与 `docs/contracts/chat-streaming-crud-contract.md`。没有为通过格式检查改动这两份无关文件。
- 登录态浏览器验收尚未执行；不运行 `migration:fresh`，本功能未新增迁移或数据库操作。

## 开发流程总览

实施范围仅包括：

- 新增只读 `get_my_information` 工具，按当前认证用户查询地址、订单和已保存图片元数据。
- 下单草稿缺少收件信息时查询本人地址簿；有地址时展示 `address_selection` 卡，由用户显式选择；查询成功为空时才请求 `purchase_recipient` 动态表单。
- 通过购买模块认证 API 将用户选择的本人地址写入当前草稿，并校验草稿状态、归属和版本。
- 将新工具和地址卡纳入现有工具运行、SSE、`publicDisplay`、历史、trace/activity 和前端卡片流程，遵守技术文档中的敏感数据隔离。

不新增数据库表、字段、Migration、运行时依赖、地址管理 CRUD、图片内容访问或正式订单操作。实施中若发现这些变化不可避免，停止并返回设计/契约阶段重新审批。

## 子代理角色和文件所有权

代码实现获批后由主代理启动三个互不重叠的子代理任务。角色按职责命名，启动时须传入本文、设计文档、CRUD 契约和技术文档，并要求每个代理先读取 `AGENTS.md`、所属开发文档及负责模块的当前源码。

| 角色           | 唯一写入范围                                                                                                                                                                                                                                                                                                                                                                         | 交付内容                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 领域查询代理   | `apps/api/src/chat-user-information/**`；`apps/api/src/virtual-try-on/service/try-on-photo.service.ts`、对应 `spec/try-on-photo.service.spec.ts`、`virtual-try-on.module.ts`、新增 `virtual-try-on/index.ts`                                                                                                                                                                         | 新查询模块、严格工具 schema、安全白名单投影、按 section 隔离故障；通过模块公开入口提供有界的 saved/active 图片元数据查询能力。 |
| 聊天与购买代理 | `apps/api/src/chat-records/**`；`apps/api/src/chat-purchase/controller/chat-purchase.controller.ts`、`dto/chat-purchase.schema.ts`、`service/purchase-draft.service.ts`、`chat-purchase.module.ts` 及该模块对应测试                                                                                                                                                                  | 请求级工具注册与分支协调、卡片来源/SSE/历史/trace 安全投影；增加认证地址选择 API 和草稿版本保护。                              |
| Web 代理       | `apps/web/src/api/modules/chat-purchase.ts`、`api/modules/user-addresses.ts`、`api/types/chat.ts`、`api/types/chat-purchase.ts`、`api/types/user-addresses.ts`；`pages/chat/index.vue`、`pages/chat/page.ts`、`components/ChatMessageList.vue`、`ChatAssistantMessage.vue`、`ChatMarkdownRenderer.vue`、`ChatCardTemplate.vue`、新增 `components/cards/ChatAddressSelectionCard.vue` | 地址选择卡、本人地址临时读取与请求取消、显式选择、过期/错误恢复；地址点击不发送聊天消息，详情不写 Pinia/localStorage。         |

文件所有权约束：

- 同一文件只能由一个代理修改；开始任务前主代理发出实际文件清单并检查未提交差异。
- 领域代理不改 `chat-records` 工具注册或购买流程；聊天与购买代理不改 `chat-user-information` 和 `virtual-try-on`；Web 代理不改 API 源码。
- `virtual-try-on/index.ts` 仅增加必要的公开模块、Service 与安全查询 DTO 类型导出，不把图片存储、任务执行等其他私有能力导出。
- 主代理独占 `apps/api/src/app.module.ts`、仓库根配置、README、公共包清单及本实施文档；预计本次不需要改依赖、迁移或根配置。
- 主代理独占 `apps/api/src/chat-dynamic-form/adapter/purchase-recipient-form.adapter.ts` 及其新增/对应测试，确保购买动态表单只请求当前草稿尚缺字段；该适配器不属于聊天/购买代理的写入范围。
- 主代理独占 `apps/web/src/stores/chat/index.ts`，增加地址选择的 Store mutation action，与购买修改、放弃和确认共用提交互斥及状态刷新。
- 主代理独占 `apps/api/src/llm/context/shopping-flow.md`、`system-context.md` 和 `apps/api/src/llm/spec/system-context.spec.ts`，同步模型指引：先查本人地址、只展示选择卡，地址选择由前端认证 API 执行，不再调用模型地址选择工具。
- 若任务中需要超出授权清单的文件，代理先报告原因和拟增文件，等待主代理调整所有权后再改；禁止代理间共享写权限。

## 子代理开始前检查

- 主代理确认实施文档已由用户明确批准，记录批准时间并确认工作区状态。
- 每个代理只读对应业务文档和当前源码，不重排模块、不还原工作区已有改动。
- 先确认 `OrdersModule`、`UserAddressesModule`、`VirtualTryOnModule` 的公开导出和 Nest 依赖方向；不跨模块导入 Entity/Repository。
- 领域代理先给出查询 DTO/公开方法签名；聊天代理按已确认的签名接入，不复制业务查询。
- Web 代理复用现有 Axios adapter、聊天卡片映射及 Formily 表单能力，不增加前端测试依赖。
- 不运行 `migration:fresh`；本功能没有获批的数据迁移。

## 子代理完成报告

每个代理完成后按下列格式提交报告：

```text
修改文件
执行命令
测试结果
未解决风险
越界修改
```

报告需区分通过、失败、跳过和未执行。代理不得把未执行的浏览器验收描述为通过。

## 主代理集成任务

- 核对所有修改均落在已分配文件范围内，保留工作区已有文档变更及用户数据。
- 审阅跨模块导入、Nest provider/export、工具注册生命周期和请求级协调器，不允许静态全局身份或跨请求状态。
- 检查地址簿查询 Promise 在同轮并发工具间复用；非空地址卡和动态表单互斥，空列表才进入自动表单分支。
- 检查每个 section 的白名单和 trace/activity/history/publicDisplay 投影，确认完整地址、订单收件信息及图片对象引用没有泄露。
- 检查地址选择 API 只接收 `addressId` 与 `expectedVersion`，服务端读取地址并复核用户、会话、草稿状态和版本。
- 检查卡片历史恢复时只使用 `draftId`/`draftVersion` 重新请求当前数据；用户选择不调用 `chat.sendMessage()`。
- 负责跨代理冲突解决、必要的共享接线、README/专题文档同步、格式化和最终验证。
- 新增代码在业务规则或复杂逻辑处补充必要中文注释，不添加逐行叙述性注释。

## 按顺序排列的实施阶段

1. **启动与冻结边界**：主代理复核获批文档、Git 状态、目标目录和检查命令；向三个代理分发互斥文件清单和已确认接口。
2. **并行模块实现**：领域查询、聊天/购买接入和 Web 卡片可并行开发；代理不得越过各自目录所有权。若接口有冲突，暂停依赖该接口的实现并由主代理协调，不通过临时复制类型规避。
3. **领域模块验收**：先审领域 schema、投影、用户归属、图片查询条件和单测；通过后确认公开 Service 可被聊天模块注入。
4. **聊天/购买集成**：审请求级工具闭包、地址查询 single-flight、表单互斥、选择 API 的严格 Zod 输入与状态/版本冲突处理；执行相关单测及 HTTP 测试。
5. **Web 集成**：审 SSE 与历史恢复、本人 API 加载/重试/取消、默认地址不预选、重复提交保护、409 刷新和账号/会话切换清理；执行 Web typecheck/build。
6. **主代理全量审阅**：整合所有报告，检查隐私投影、异常路径、兼容性、公共导出与既有购买/卡片/动态表单行为；对发现的问题定向返工。
7. **最终验证与记录**：运行本文件“验收标准”中的命令；更新实施文档交付记录，逐项说明实际验证和未执行项。

## 验收标准

- `get_my_information` 输入严格校验、身份由当前认证上下文绑定；地址/订单/图片按契约投影，section 故障互不影响且不泄露异常。
- 下单时完整收件信息优先使用本轮输入；有效草稿缺字段且地址非空时只展示选择卡；成功空列表才创建动态表单；查询失败不会伪装成空列表。
- 地址卡默认不选中地址，只携带草稿引用；选择操作经认证 API 完成并校验地址归属、草稿状态和版本。
- 完整地址、订单收件信息、图片对象键/URL/内容不进入模型结果、trace、activity、聊天历史、`publicDisplay`、Pinia/localStorage 或普通日志。
- 历史卡片重新读取本人当前地址和草稿；旧版本、已结束草稿、未登录/切换账号、网络失败和重复点击均安全降级。
- 旧 `select_my_shipping_address` 模型工具不再执行；旧 trace 兼容读取与历史过滤按技术文档实现。
- 不新增 Migration、数据库字段或运行时依赖；既有商品/订单卡、Formily 动态表单和购买确认流程保持兼容。
- 至少通过格式检查、API typecheck/test/build、Web typecheck、仓库 `pnpm check` 和 `git diff --check`。需数据库的测试只连接具名隔离数据库并按仓库 `RUN_*` 门禁运行。
- 人工验收覆盖登录后的地址卡加载、选择和历史恢复，以及窄屏、键盘操作。基础设施或凭据不可用时如实标记未执行。

计划验证命令：

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

## 风险和停止条件

- LangGraph 工具并行可能导致地址卡与表单竞态；若无法用同一请求级地址查询结果和 single-flight 保证互斥，停止集成，不以提示词顺序替代后端协调。
- 若实现需要把地址详情放入模型、trace、activity、历史或持久化前端 Store，立即停止并回到设计/安全契约评审。
- 若必须新增数据库持久状态、Migration、跨用户查询、地址写入权限或正式订单操作，当前审批不覆盖这些行为，停止并重新走设计及契约审批。
- 若历史恢复无法校验当前账号、会话、草稿状态和版本，卡片必须禁用，不允许以历史数据授权写操作。
- 若任何代理越界修改其他代理/用户文件，先停止该代理任务、保留现场并由主代理逐项审查；不得批量回滚或重置工作区。
- 测试数据库、登录凭据或浏览器环境不可用时，停止相应真实 Smoke Test 并记录缺口；不得改用默认数据库或破坏性 `migration:fresh`。
