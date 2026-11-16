# 对话工具能力清单

- 盘点日期：2026-11-16
- 范围：普通用户聊天中由模型发起的工具调用，以及与工具相邻的前端操作。
- 依据：当前源码和已确认业务契约。此文档记录能力现状与扩展候选，不代表候选能力已获准实施。
- 扩展方案：[扩展设计](./chat-tool-expansion-design.md)、[增量契约](../contracts/chat-tool-expansion-crud-contract.md)、[首期技术方案](./chat-tool-expansion-technical.md)及[实施记录](./chat-tool-expansion-implementation.md)均已确认；首期试穿任务查询已接入。第二阶段[设计](./chat-tool-phase-two-design.md)、[技术](./chat-tool-phase-two-technical.md)及[实施记录](./chat-tool-phase-two-implementation.md)也已确认，精确规格和本人偏好工具已注册；各阶段实际验证及缺口见对应记录。其他候选仍未实施。

## 工具调用原则

- 适合工具调用：模型需要查询服务端权威事实，或在当前会话中请求一个受限、可验证的界面。
- 适合前端操作：用户必须选择、确认、提交或授权的动作。前端通过认证 API 提交，模型不代替用户点击。
- 工具的用户、会话和资源归属由服务端绑定或校验；模型不能自行指定 `userId`，不能以工具参数或 Markdown 构造可执行卡片。
- 动态表单只接受服务端注册的 `formKind` 和字段；表单提交仍由前端调用业务 API，模型既不接收也不提交用户填写值。
- 新工具先确认信息来源、权限、输出白名单、trace/activity 脱敏和失败语义，再实现和登记对应契约。

## 当前已接入的模型工具

以下工具由 [`ChatRecordsService`](../../apps/api/src/chat-records/service/chat-records.service.ts) 在每轮聊天中组装。

| 工具                             | 当前能力                                                                                               | 边界                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `search_local_clothing_products` | 按明确需求查询本地有效服装和鞋类，返回商品、尺码/颜色摘要、价格、有货状态和匹配理由。                  | 每轮最多查询一次，最多返回 3 件；商品事实只能来自工具结果。                                                         |
| `get_product_skus`               | 用可信商品外部标识及可选颜色、尺码精确查询当前有效 CNY 规格、单价和预占后有货状态。                    | 完整过滤后分页，每页5条、页码1–10；不返回 SKU ID、图片或库存数量，不选择规格或授权购买。                            |
| `get_my_preferences`             | 用户明确查询时读取本人有效且未删除的已保存偏好，可筛选九类之一。                                       | 每页5条、页码1–10；关闭返回 preferences_disabled，缺设置不补建；不写偏好或改开关。                                  |
| `get_purchase_draft`             | 读取本人当前购买草稿、规格和缺失字段。                                                                 | 不向模型返回收件字段值。                                                                                            |
| `update_purchase_draft`          | 按用户本轮明确提供的值更新本人未提交草稿。                                                             | 受字段、草稿版本和资源归属校验；信息有歧义时须先询问。                                                              |
| `discard_purchase_draft`         | 放弃本人未提交的购买草稿。                                                                             | 不取消正式订单。                                                                                                    |
| `request_purchase_form`          | 请求前端打开本人当前仍可编辑的购买草稿弹框。                                                           | 无参数、只用于 SSE；服务端重读并校验草稿，不创建或修改购买。                                                        |
| `list_my_orders`                 | 查询最多 5 笔本人订单摘要；待付款筛选可返回服务端确认的取消候选。                                      | 只读；不提供收件信息，不执行取消、支付或收货。                                                                      |
| `get_my_information`             | 查询本人地址引用、订单摘要、已保存图片元数据，或显式请求的试穿任务摘要；下单缺地址时启动地址选择流程。 | 省略 sections 仍为原三类；试穿只返回本人未删除任务，每页5条、最多10页，不返回图片/结果ID/存储键，不触发生成或下载。 |
| `request_dynamic_form`           | 请求前端渲染服务端注册的动态表单；目前购买收件信息使用 `purchase_recipient`。                          | 工具只发出表单定义和安全引用；不能读取或提交用户填写值。                                                            |
| `display_chat_card`              | 展示本轮已查询并登记的商品卡或只读订单卡。                                                             | 只接受可信查询结果的引用，不接受模型编写的商品、订单事实。                                                          |

商品搜索和订单查询的工具实现分别位于 [`product-search.tool.ts`](../../apps/api/src/product-catalog/tool/product-search.tool.ts) 与 [`list-user-orders.tool.ts`](../../apps/api/src/orders/tool/list-user-orders.tool.ts)。购买草稿工具、购买弹框请求工具、用户信息工具、动态表单工具和卡片工具分别位于 [`purchase-tools.ts`](../../apps/api/src/chat-purchase/tool/purchase-tools.ts)、[`request-purchase-form.tool.ts`](../../apps/api/src/chat-purchase/tool/request-purchase-form.tool.ts)、[`chat-user-information.tool.ts`](../../apps/api/src/chat-records/tools/chat-user-information.tool.ts)、[`request-dynamic-form.tool.ts`](../../apps/api/src/llm/tools/request-dynamic-form.tool.ts) 和 [`chat-card-display.tool.ts`](../../apps/api/src/chat-records/display/chat-card-display.tool.ts)。

精确规格和本人偏好工具分别位于 [`chat-product-skus.tool.ts`](../../apps/api/src/chat-records/tools/chat-product-skus.tool.ts) 和 [`chat-preferences.tool.ts`](../../apps/api/src/chat-records/tools/chat-preferences.tool.ts)。二者共用 JSON/SSE 装配，领域读取为独立只读 RR 快照；经校验调用后，无论成功、空、关闭或失败，整轮退出自动记忆和摘要来源，下一普通轮恢复。trace 仅保留计数、枚举和标记，activity 输入输出为 null，历史成对隐藏工具调用和结果；最终聊天正文仍保存。

## 已有但不是模型自主选择的调用

| 能力                      | 当前入口                                                                                          | 判断                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 虚拟试穿 `try_on_product` | 用户从合格商品卡发起试穿、选择本人照片并明确同意后，服务端在聊天运行中调用试穿工具。              | 这是用户授权后的确定性服务端动作，不是模型自由选择商品或照片。照片上传、选择和同意必须由用户完成。 |
| 下单地址选择卡            | `get_my_information` 查询地址后，服务端按购买草稿状态生成卡片；用户在前端读取本人地址并明确选择。 | 地址选择不是模型工具。模型不能代选默认地址，完整地址不回传模型。                                   |
| 动态表单提交              | 用户在动态表单输入后，由前端认证 API 提交给对应业务处理器。                                       | 表单工具只负责请求渲染，不是表单提交工具。                                                         |
| 商品下一页                | 用户点击商品结果组的“查看更多”，前端沿原查询条件和游标直接分页。                                  | 不再调用模型，避免重复生成、改变查询条件或虚增商品。                                               |

## 可补充或扩展的工具

按用户收益、现有数据源和安全边界排序。以下均为候选，实施前仍需按项目流程确认范围并更新相应契约。

### 可选的界面请求

- **地址簿表单 `request_address_form`**：适用于“在聊天里新增/修改收货地址”。地址簿已有本人 CRUD API，但当前动态表单注册类型只有购买收件字段。若扩展，只由工具请求渲染受限表单；地址新增/修改必须由用户在前端确认提交，完整地址不得进入模型、trace 或通用 activity。
- **偏好编辑界面 `request_preference_form`**：适用于“帮我修改保存的穿衣偏好”。偏好管理页面和本人 CRUD API 已存在。工具最多请求打开编辑界面并预选安全字段；不能直接写入、删除偏好或改变设置。

### 需先确认数据与权限

- **订单物流摘要 `get_my_order_fulfillment`**：适用于“我的订单发货了吗，物流状态是什么”。现有工具故意不返回完整物流字段，用户信息契约也限制物流数据进入模型。需先确认可以公开给模型的字段、实时数据源和 trace 脱敏；收件地址、完整物流单号及支付凭证不应进入模型。没有承运商实时数据时只能如实报告本地发货记录。
- **店铺政策/售后知识查询**：可回答运费、退换条件、退款进度和售后流程，但当前没有已确认的店铺政策知识库或售后业务 API。先建立经审核、可维护的来源；未接入前不创建会编造承诺的工具，也不声称能办理退款、退货或换货。

## 保留为明确用户操作

以下功能不应由模型工具直接执行；模型可以说明流程、查询安全摘要，或请求打开相应界面，但最终动作由用户在前端确认：

- 创建正式订单、模拟支付、取消正式订单、确认收货。
- 选择、保存、修改或删除收货地址；下单地址选择必须点击确认。
- 提交动态表单中的收件信息或其他个人填写值。
- 上传/选择试穿照片、同意照片处理、删除照片或试穿结果。
- 商品结果分页及购买卡片内的规格选择和最终下单确认。
- 偏好新增、修改、删除和设置开关。
- 管理员商品、库存、用户和订单履约操作。

这些操作由现有认证 API 和页面处理。若将来增加“打开界面”的工具，该工具只能请求显示受限 UI，不得绕过原 API 的身份、版本、权限和用户确认校验。

## 不纳入当前工具范围

- 已付款订单取消、真实支付、退款、退货和换货：当前没有相应业务能力，不能只靠增加工具实现。
- 完整收件信息、付款凭证、图片内容、对象存储键、长期签名 URL：不作为模型工具输入、输出或 trace 数据。
- 任意 URL 抓取、任意 SQL/数据库查询、模型指定用户 ID、动态生成校验代码或未注册表单：不开放。
- 管理员跨用户查询和操作：不通过普通用户聊天工具提供。

## 代码与契约核对点

- 普通聊天工具组装入口：[`chat-records.service.ts`](../../apps/api/src/chat-records/service/chat-records.service.ts)。
- 工具/地址/订单/购买边界：[`security-and-business-boundaries.md`](../development/security-and-business-boundaries.md)、[用户信息契约](../contracts/chat-user-information-crud-contract.md)、[购买契约](../contracts/chat-purchase-crud-contract.md)。
- 动态表单边界：[动态表单契约](../contracts/chat-dynamic-form-crud-contract.md)。
- 试穿动作边界：[聊天试穿工具契约](../contracts/chat-try-on-tool-contract.md)、[试穿任务 API 契约](../contracts/virtual-try-on-crud-contract.md)。
- 偏好边界：[用户偏好契约](../contracts/user-preferences-crud-contract.md)。
- 购买弹框请求：`request_purchase_form` 和 `purchase-form` 已按购买/流式契约接入；自动化覆盖本人草稿状态、空载荷及 SSE/JSON 通道边界。登录态浏览器交互仍待验收。
