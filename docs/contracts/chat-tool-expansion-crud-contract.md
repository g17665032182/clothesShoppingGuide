# 对话工具扩展增量契约

## 状态与适用范围

- 状态：首期和第二阶段设计、业务契约、技术及实施文档均已确认，代码已接入；验证与缺口分别见各阶段实施记录。
- 最后更新：2026-11-16。
- 设计依据：[对话工具能力扩展设计](../llm/chat-tool-expansion-design.md)。
- 关联现有契约：[用户信息查询](./chat-user-information-crud-contract.md)、[虚拟试穿](./virtual-try-on-crud-contract.md)、[商品目录](./product-catalog-crud-contract.md)、[用户偏好](./user-preferences-crud-contract.md)。

本文集中列出新增的只读工具行为。首期已接入 `try_on_tasks` section，对应领域契约已附增量说明。第二阶段不因首期确认而自动进入技术或代码阶段。

2026-11-16 用户回复“可以”，批准[精确规格与本人偏好设计](../llm/chat-tool-phase-two-design.md)及本文第二阶段规则，包括偏好开关和整轮记忆/摘要隔离，随后分别回复“确认”批准[技术文档](../llm/chat-tool-phase-two-technical.md)及[实施文档](../llm/chat-tool-phase-two-implementation.md)。

## 通用契约

- 认证、账号有效性及会话访问沿用现有聊天接口；所有私人数据查询绑定服务端当前用户。schema 不接受 `userId`、`conversationId`、任意 URL、对象键或数据库查询表达式。
- 对象严格拒绝未知字段。工具数字参数为实际整数，不接受数字字符串；页码 1–10，省略为 1，每页固定 5 条，不接受模型指定 `pageSize`。
- 工具查询无写入副作用，不新增 HTTP 路由或数据库迁移；JSON/SSE 聊天使用同一查询边界。
- 页码超出匹配列表返回成功空页和真实总数。列表在稳定排序后分页，不能通过先截断后过滤伪造总数。
- 查询型工具成功结果由服务端生成 JSON；不能接受模型重新编写的事实作为结果。
- 不增加结果卡片、可执行引用、下载授权或后续写操作令牌。

## 第一阶段：`get_my_information` 增量

### 输入

```json
{
  "sections": ["try_on_tasks"],
  "tryOnStatus": "processing",
  "page": 1
}
```

| 字段                | 新增或兼容规则                                                                     |
| ------------------- | ---------------------------------------------------------------------------------- |
| `sections`          | 新增 `try_on_tasks`；显式传入时四类中选 1–4 项，不重复；省略仍为原三个 section     |
| `tryOnStatus`       | 可选 `queued`、`processing`、`succeeded`、`failed`；仅在包含 `try_on_tasks` 时允许 |
| `orderNo`、`status` | 保留原订单筛选语义，只能在包含 `orders` 时出现                                     |
| `page`              | 沿用原规则；混合 section 查询使用同一页码，各自独立分页                            |

不接收 `taskId`、`photoId`、`resultId`、`unread`、`deleted` 状态或业务动作参数。默认只查询本人未删除任务，按创建时间倒序及稳定的同时间次序返回。

### 成功响应

沿用 `{ ok: true, sections, errors }`，新增 `sections.try_on_tasks`：

```json
{
  "ok": true,
  "sections": {
    "try_on_tasks": {
      "items": [
        {
          "taskId": "uuid",
          "status": "succeeded",
          "product": {
            "externalId": "example-product",
            "name": "示例外套",
            "category": "outerwear",
            "color": "黑色"
          },
          "createdAt": "2026-11-13T00:00:00.000Z",
          "completedAt": "2026-11-13T00:01:00.000Z",
          "resultAvailable": true
        }
      ],
      "page": 1,
      "pageSize": 5,
      "total": 1
    }
  },
  "errors": []
}
```

- `taskId` 仅为服务端已确认归属的任务安全引用，不是操作或下载凭据；本阶段没有接受该引用的新增工具。
- `completedAt` 未完成时为 null；`resultAvailable` 必须依据当前任务和结果有效状态计算，不能仅凭 `succeeded` 推断。
- 商品字段为任务的服务端快照，不代表当前价格、库存或试穿准入条件。
- 禁止字段包括输入照片 ID、结果 ID、商品/人物/结果图片 URL、对象键、图片内容、同意记录、供应商信息、原始失败原因和内部执行计数。
- 查询不得创建任务、自动重试任务、消费生成额度、请求结果文件或标记通知已读。

读取失败时在 `errors` 增加 `{ "section": "try_on_tasks", "code": "unavailable" }` 并省略该 section，其他 section 按原规则返回。无任务为成功空列表，不能用失败代替空列表或反向转换。

## 第二阶段：`get_product_skus`

### 输入

| 字段                | 规则                                   |
| ------------------- | -------------------------------------- |
| `productExternalId` | 必填；trim 后 1–160 字符，拒绝控制字符 |
| `color`             | 可选；trim 后 1–32 字符，拒绝控制字符  |
| `size`              | 可选；trim 后 1–32 字符，拒绝控制字符  |
| `page`              | 通用页码规则                           |

颜色与尺码沿用商品领域现有的输入 trim、数据库 lower 比较，不做别名翻译、模糊搜索、兼容归一化或跨品牌换算，不自动放宽。筛选作用于完整有效且币种为 CNY 的规格集合后，再按内部 SKU ID 升序分页；ID 不输出，现有商品 HTTP SKU 列表规则保持不变。

商品标识只能依据用户明确提供的外部标识或可唯一确定的可信商品引用，名称或指代有歧义时先询问。禁止通过先读取默认页或固定数量再过滤来判断无匹配。

### 输出

成功为 `{ ok: true, productExternalId, items, page, pageSize, total, hasNext }`。

`items` 仅包含 `color`、`size`、`unitPrice`、`currency`、`inStock`。`unitPrice` 为合法十进制金额字符串，`currency` 为当前目录支持的 `CNY`；`inStock` 沿用商品领域扣除有效预占后的判断，不公开数量。

商品无效或不存在返回 `{ ok: false, code: "not_found" }`；商品有效但无匹配组合返回成功空列表；依赖失败返回 `{ ok: false, code: "unavailable" }`。查询不预占库存、不修改草稿、不选择规格、不保证最终成交价。

不合并相同颜色和尺码的不同 SKU。`hasNext` 表示实际仍有匹配结果；第 10 页仍有后续时提示聊天页码上限并引导原购买界面，不调用第 11 页。输出损坏或无法安全投影时按 unavailable 处理。

## 第二阶段：`get_my_preferences`

### 输入与输出

- 输入：可选一个 `category` 及 `page`；类别沿用现有九类偏好，不新增类别或自由文本筛选表达式。
- 仅查询本人 active 且 deletedAt 为 null 的记录；类别过滤在计数及分页前执行，不按相关性截断候选。
- 排序：主偏好优先，其次更新时间倒序，最后按内部 ID 升序保证稳定，ID 不输出。
- 成功：`{ ok: true, items, page, pageSize, total, hasNext }`。
- `items` 白名单：`category`、`valueType`、`value`、`isPrimary`、`updatedAt`；`value` 继续使用既有类别和安全校验，valueType 必须与类别匹配，不能透传任意 JSON。损坏或不安全结果返回 unavailable，不静默漏项后声称完整。
- 不返回偏好 ID、用户 ID、来源会话/消息、任务或指纹字段，不读取 Markdown 记忆文档。
- 无有效偏好返回成功空列表；依赖失败返回固定 `unavailable`，不以已注入的相关性上下文补齐完整结果。
- 已确认：独立偏好开关 enabled 为 false 时返回 `{ ok: false, code: "preferences_disabled" }`，不读取或返回偏好值。本人管理 API 不受影响，关闭不删除记录。此增量扩展原“只控制聊天注入”的语义。
- 设置缺行按既有默认 true 解释，查询不补建设置，不 flush、不启动或恢复任务。开关与结果保持同次一致读取，新查询重新读取状态；已进入历史的正文不会因之后关闭而撤回。Markdown 记忆开关不控制此工具。
- `hasNext` 及第 10 页后的引导与 SKU 工具相同，进入原偏好管理页面继续查看。

工具不接收新增、更新、删除、切换开关、恢复任务或授权自动提取参数。

## 追踪、展示与历史

- 工具输入追踪仅保存工具名、section/类别/状态枚举及有界页码；第二阶段只额外记录颜色/尺码筛选是否存在，不记录商品标识或筛选文本。嵌套和非法工具调用同样采用白名单，禁止原样复制未知参数。
- 工具结果 trace 只记录成功/失败、结果数量、section 和固定错误码，不记录偏好值、任务 ID 集合或原始业务响应。SSE activity 沿用既有工具名与执行状态，input/output 保持 null，不新增计数或业务结果载荷。
- 安全投影在领域数据进入模型和追踪之前执行；原始任务响应中的图片字段不能先进入工具事件再被前端隐藏。
- 本阶段不新增 `publicDisplay` 类型，不把原始工具 JSON 写入公开历史。assistant 最终的安全摘要沿用既有消息保存规则。
- 数据为本轮权威查询结果，不能将库存、任务状态、临时故障或偏好查询回显自动作为长期记忆更新来源；技术阶段必须明确相关性和来源去重保护。
- 旧历史、已有商品/订单/购买卡片及动态表单继续兼容。资源已删除时，历史中的摘要或安全引用不恢复资源、不绕过本人 API。

第二阶段已确认的来源隔离规则：本轮经校验调用 get_product_skus 或 get_my_preferences 后，无论成功、空列表、开关关闭、not_found 或 unavailable，整轮两条消息不作为自动 Markdown 记忆及摘要来源，不登记记忆提取任务。沿用第一阶段的来源资格保护，混合批次和缓存重试不得重新读入；同轮其他背景也跳过，下一普通轮恢复。该规则不重写旧消息、旧记忆或手动管理数据；最终正文仍保存。本规则于第二阶段设计审批中另获用户确认。

## 验收与待确认

以下已勾选项包含第一阶段已有证据；第二阶段实现已接入，独立验收矩阵、实际命令与未执行项见[第二阶段实施记录](../llm/chat-tool-phase-two-implementation.md)，不以首期结果替代。

- [x] 严格输入校验、分页边界、默认 sections 和筛选字段组合均有覆盖。
- [x] 本人隔离和安全错误一致；只读查询无写入、下载或外部供应商副作用。
- [x] SKU 过滤发生在分页前，价格/可售状态来自领域公开能力；第二阶段单测和真实 PostgreSQL 验证通过。
- [x] 偏好开关语义经确认，响应不包含来源信息、敏感字段或记忆文档；第二阶段独立验证关闭不读值、缺设置不补建。
- [x] 模型结果、trace、activity 和公开历史分别验证安全投影。
- [x] JSON/SSE 工具往返和旧购买、地址、表单、推荐路径兼容。

首期已确认并接入：仅试穿任务查询、每页 5 条、最多 10 页、只做摘要。[首期技术文档](../llm/chat-tool-expansion-technical.md)和[实施文档](../llm/chat-tool-expansion-implementation.md)已确认，实际验收与未执行项见实施记录。

2026-11-16 用户要求推进第二阶段，随后回复“可以”批准设计与本契约，分别回复“确认”批准技术及实施文档。偏好开关和来源隔离规则已实现，两工具使用现有 JSON/SSE 通道，无新增路由、迁移或写权限；验证与剩余缺口见第二阶段实施记录。
