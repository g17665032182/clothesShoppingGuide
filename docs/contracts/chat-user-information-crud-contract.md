# 聊天用户信息查询工具 CRUD 契约

## 状态与依据

- 状态：用户已于 2026-11-13 确认；包含下单地址选择卡片和用户显式选择流程。
- 资源：当前认证用户的地址簿、订单和已保存图片安全摘要。
- 所属模块：`llm` 工具编排；地址、订单和虚拟试穿模块提供公开查询 Port。
- 最后更新：2026-11-13。
- 关联文档：[用户信息查询工具设计](../modules/chat-user-information/chat-user-information-design.md)、[地址契约](./user-address-crud-contract.md)、[订单契约](./order-crud-contract.md)、[聊天记录契约](./chat-records-crud-contract.md)。

本契约只描述聊天工具的只读查询边界，不替代地址、订单、图片模块自己的 CRUD 契约。

## 权限与身份

- 仅已认证普通用户可通过聊天调用。
- `userId` 必须来自服务端当前用户上下文，工具 schema 不接收该字段。
- 查询范围始终是当前用户本人；不存在或不属于本人的资源不得通过错误信息区分。
- 管理员、客服和服务端脚本若需跨用户查询，必须使用独立的后台 API 和授权契约。

## 工具契约

工具名：`get_my_information`

严格输入：

```json
{
  "sections": ["addresses", "orders", "photos"],
  "orderNo": "可选",
  "status": "可选",
  "page": 1
}
```

| 字段       | 类型                          | 规则                                                      |
| ---------- | ----------------------------- | --------------------------------------------------------- |
| `sections` | 枚举数组                      | `addresses`、`orders`、`photos`；1–3 项且不得重复；可省略 |
| `orderNo`  | 字符串或省略                  | trim 后 1–100 字符；只用于订单 section                    |
| `status`   | 现有 `OrderStatus` 枚举或省略 | 只用于订单 section                                        |
| `page`     | 整数或省略                    | 1–10，默认 1                                              |

对象使用 `z.strictObject`；未知字段、空 sections、重复 sections、非法状态、过大字符串和越界分页返回工具输入错误。模型不得提交 userId、conversationId、addressId、orderId、photoId、URL、对象键或业务动作参数。

## 下单流程联动

当前购买草稿缺少收件信息且用户本轮未提供完整收件信息时，聊天编排按以下顺序执行：

1. 调用 `get_my_information`，参数只包含 `sections: ["addresses"]` 和 `page: 1`，查询当前用户地址簿。该查询是下单流程的一部分，不要求用户另外提出查看地址。
2. 查询成功且地址簿非空时，发送 `address_selection` 前端卡片事件。安全卡片引用只绑定当前用户会话、assistant 消息及购买草稿 ID/version，不包含姓名、电话、详细地址或用户自定义标签。
3. 卡片由前端使用当前认证身份调用本人地址列表 API，临时展示最新地址详情。默认地址可以标识，但不得自动选中、自动写入草稿或代替用户确认。
4. 用户点击选择某个地址后，前端调用 `POST /api/chat/conversations/:conversationId/purchase-draft/:draftId/select-address`，提交 `addressId` 和 `expectedVersion`，不依赖模型再次解释或选择。服务端重新验证地址归属、地址仍有效及草稿版本后，将地址快照写入草稿；地址完整值不得经过模型工具参数或结果。
5. 查询成功且地址簿为空时，调用 `request_dynamic_form`，使用 `purchase_recipient` 注册表询问尚缺的收件字段；用户提交后只更新本人购买草稿。
6. 查询失败时不按空地址簿处理，不直接请求表单；向用户说明并提供重试。用户明确选择改为手工填写后，才调用动态表单。
7. 本轮用户已明确提供完整收件信息时，使用本轮信息，不再要求重复选择。

卡片不是默认地址授权、地址选择结果或下单确认凭据。正式下单仍需要用户在购买界面显式确认。

## 安全响应

工具成功响应为 JSON 字符串，结构固定：

```json
{
  "ok": true,
  "sections": {
    "addresses": {
      "items": [],
      "page": 1,
      "pageSize": 5,
      "total": 0
    },
    "orders": {
      "items": [],
      "page": 1,
      "pageSize": 5,
      "total": 0
    },
    "photos": {
      "items": [],
      "page": 1,
      "pageSize": 5,
      "total": 0
    }
  },
  "errors": []
}
```

未请求的 section 可以省略。每个 section 的最大返回条数为 5；服务端不得因为模型要求更大分页而返回更多数据。

### 地址项目

```json
{
  "addressId": "uuid",
  "isDefault": true,
  "displayName": "默认地址"
}
```

禁止字段：`recipientName`、`phone`、`address`、完整 `label`、数据库内部字段。

### 订单项目

允许字段：`orderNo`、`status`、`closeReason`、`itemsAmount`、`payableAmount`、`itemCount`、`createdAt`、`paidAt`、`shippedAt`、`completedAt`、`items`。

订单 `items` 允许字段：`productName`、`color`、`size`、`quantity`。

禁止字段：`userId`、`id`、`recipient`、`recipientName`、`recipientPhone`、`recipientAddress`、`shipment`、`trackingNo`、`skuId`、`productExternalId`、`imageUrl`、支付凭据。

### 图片项目

```json
{
  "photoId": "uuid",
  "kind": "person",
  "mimeType": "image/jpeg",
  "byteSize": 123456,
  "width": 1200,
  "height": 1600,
  "createdAt": "2026-11-13T00:00:00.000Z",
  "availability": "saved"
}
```

仅允许 `saved` 且 `active` 图片的元数据。禁止 `objectKey`、`url`、`signedUrl`、`base64`、`buffer`、原始文件内容和临时上传记录。

## 部分成功与错误

每个 section 独立读取。部分 section 成功时 `ok` 仍为 `true`，失败 section 写入固定错误：

```json
{
  "section": "photos",
  "code": "unavailable"
}
```

允许错误码：

| 错误码          | 语义                                            |
| --------------- | ----------------------------------------------- |
| `invalid_input` | 工具参数不符合严格 schema                       |
| `unavailable`   | 依赖服务暂时不可用，不能暴露底层异常            |
| `not_found`     | 当前 section 没有可返回资源或资源不属于当前用户 |

工具结果不得包含 SQL、堆栈、异常消息、手机号、地址文本、对象存储键或第三方凭据。

## 展示、历史与追踪

- 工具输入 trace 只保留工具名称、section 枚举和有界筛选摘要；不记录完整用户输入对象之外的敏感值。
- 工具结果 trace/activity 只能保存 section 数量、状态和安全摘要；不得保存完整地址、图片 URL、Base64 或内部 ID 集合。
- 普通聊天历史不保存工具原始 JSON。若后续展示卡片，必须通过服务端 `publicDisplay` 白名单投影并绑定 assistant 消息。
- 用户填写或选择后的完整地址只进入现有本人 API 和购买草稿流程，不回流模型。
- 该工具无提交、更新、删除、确认或支付操作，因此不定义写入 API。
- 本工具本身保持只读；下单地址卡只保存安全草稿引用，地址详情由前端本人 API 临时读取；用户选择后由服务端校验当前本人草稿和版本并写入。
- 地址选择卡的选择操作必须是显式用户点击触发的认证服务端写入；禁止将完整地址传回模型或把点击行为编码成普通聊天文本后等待模型决定是否执行。

## 兼容性与数据变更

- 首版不新增数据库表、字段、索引或迁移。
- 复用地址、订单和已保存图片的公开查询能力；不能直接依赖 Entity/Repository。
- 工具注册必须受现有聊天工具开关和当前认证上下文控制。
- 未请求 section、空结果和单 section 失败不得破坏现有聊天正文、商品卡、订单卡、购买卡和试穿卡。
- 若后续新增地址/图片卡片、短期缩略图 API 或管理员查询，必须另行更新设计、技术和契约文档。

## 验收清单

- [x] 严格拒绝未知输入字段、未知 section、重复 section 和越界分页。
- [x] userId 不来自模型参数，所有查询均绑定当前认证用户。
- [x] 地址安全投影不含姓名、手机号、详细地址。
- [x] 订单安全投影不含收件信息、物流信息、内部 ID 和图片 URL。
- [x] 图片安全投影只含已保存图片元数据，不含内容和 URL。
- [x] section 失败只返回固定错误码，部分成功可继续使用。
- [x] 工具只读，不触发订单、地址或图片写操作。
- [x] 下单时收件信息缺失会查询地址簿；地址非空时展示卡片，由用户显式选择。
- [x] 地址簿为空时才调用 `request_dynamic_form`；查询失败不会误走空地址分支。
- [x] 默认地址只作为卡片标记，不自动选中或写入购买草稿。
- [x] 地址详情不进入模型、trace、activity、聊天历史或 `publicDisplay`。
- [ ] 登录态浏览器验收及当前回合完整地址优先路径。
- [x] trace、activity、历史均通过白名单脱敏。
- [x] 默认数据库未执行破坏性操作；首版无迁移。

## 审批门槛

设计、CRUD 契约、技术与实施文档均已获用户确认。实现和自动化验证见[实施记录](../modules/chat-user-information/chat-user-information-implementation.md)；登录态浏览器验收尚未执行。

## 2026-11-13 增量：本人试穿任务查询

- 状态：增量设计、业务契约、技术及实施文档均已确认，第四类 section 已接入；省略 sections 仍只查询上文原三类。验证与缺口见[实施记录](../modules/llm/chat-tool-expansion-implementation.md)。
- 依据：[扩展设计](../modules/llm/chat-tool-expansion-design.md)、[增量契约](./chat-tool-expansion-crud-contract.md)、[首期技术方案](../modules/llm/chat-tool-expansion-technical.md)。
- `get_my_information` 增加显式请求的 `try_on_tasks`；省略 sections 仍只读取 addresses/orders/photos。显式可选四类中的 1–4 项，不重复。
- `tryOnStatus` 仅配合 try_on_tasks 使用，允许 queued/processing/succeeded/failed；订单 status 不变。页码为实际整数 1–10，每页固定 5 条，不接收 taskId、unread 或动作参数。
- `sections.try_on_tasks` 为 `{ items, page, pageSize: 5, total }`。任务项目只含 taskId、四种状态、商品 externalId/name/category/color 快照、createdAt、可空 completedAt 和 resultAvailable。
- resultAvailable 来自当前本人未删除任务和结果记录，不返回照片引用、图片 URL、结果 ID、对象键、供应商信息或原始失败原因。查询不下载图片、不生成任务、不标记已读。
- 失败单独返回 `{ section: "try_on_tasks", code: "unavailable" }`，无记录是成功空列表。trace 只记枚举、数量、分页和固定错误；原始工具结果不写公开展示或历史。
- 首期不新增 HTTP 路由、SSE 事件、数据库字段、卡片或前端页面。记忆/摘要整轮隔离细化见技术方案，实施状态不得以本条确认代替。
