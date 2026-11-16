# 对话地址管理界面请求实施文档

## 状态与开发流程

- 状态：已完成实施；自动化测试和登录态浏览器验收暂缓。
- 日期：2026-11-16。
- 设计依据：[设计文档](./chat-tool-address-form-design.md)。
- 技术依据：[技术文档](./chat-tool-address-form-technical.md)。
- 行为契约：[CRUD 契约](../../contracts/chat-tool-address-form-crud-contract.md)。

用户已确认设计与 CRUD 契约、技术方案，并要求直接完成文档后按本文实施。实施只增加 SSE 地址管理页导航请求，不增加地址读取/写入能力。用户此前明确要求暂不做测试，本阶段不新增或运行测试；完成后由主代理检查代码差异、文件边界和静态契约，并运行格式、类型和构建检查。

开发顺序：

1. 主代理完成技术文档、本文和审批状态同步。
2. 后端编排、后端 trace/history、Web 三个子代理按互斥文件所有权实施，不修改测试文件。
3. 主代理审阅集成结果，修复跨边界问题并做静态检查、格式检查、类型检查和构建。
4. 测试和浏览器验收继续暂缓，等待用户另行授权。

## 子代理角色和文件所有权

### A：后端工具与 SSE 编排

负责：

- `apps/api/src/chat-records/tools/request-address-form.tool.ts`（新增）
- `apps/api/src/chat-records/service/chat-records.service.ts`

要求：

- 工具使用严格空对象 schema，固定返回 `{ ok: true, code: 'requested' }` 或 `{ ok: false, code: 'unavailable' }`。
- 仅在 SSE 工具集合注册；非流式 JSON 聊天不注册。
- 在 `PreparedChat` 中维护本轮 pending/已发送状态，首次有效调用胜出，并在现有流事件边界发送一次 `{ type: 'address-form' }`。
- 不访问地址 Entity、Repository、DTO、读取服务或地址 API。
- 为新增业务状态和非显然的时序规则添加简洁中文注释。
- 不运行测试；格式、类型和构建检查由主代理在集成后统一执行。

禁止修改：

- `history/`、`trace/`、`display/`、Web 文件、文档和测试文件。

### B：历史恢复与 trace 隐私

负责：

- `apps/api/src/chat-records/history/chat-history.mapper.ts`
- `apps/api/src/chat-records/trace/chat-trace-writer.service.ts`

要求：

- 历史恢复时配对隐藏 `request_address_form` 的调用、嵌套/非法调用及结果，包含孤立结果。
- trace 参数固定投影为空对象；结果只允许 `ok` 与 `requested` / `unavailable` 固定代码。
- 独立工具事件和嵌套于模型响应的调用都使用同一白名单规则。
- 不改变其他工具现有脱敏行为。
- 为新增业务规则添加简洁中文注释。
- 不运行测试；格式、类型和构建检查由主代理在集成后统一执行。

禁止修改：

- 工具、编排 Service、其他 API 文件、Web 文件、文档和测试文件。

### C：Web SSE 协议与一次性导航

负责：

- `apps/web/src/api/types/chat.ts`
- `apps/web/src/api/modules/chat.ts`
- `apps/web/src/stores/chat/session.ts`
- `apps/web/src/stores/chat/index.ts`
- `apps/web/src/pages/chat/page.ts`

要求：

- SSE parser 仅接受空对象 `address-form` payload；未知键、错误 JSON、非对象均不得触发导航。
- 请求仅绑定当前活动会话、聊天页生命周期和当前认证身份；复用既有身份版本机制，不持久化。
- 去重后固定导航至命名路由 `account-addresses`，并仅按真实目标路由结果显示固定成功 Toast；失败、取消或重定向显示固定失败 Toast。
- 会话/身份切换、页面离开、会话删除或任务失效时丢弃陈旧请求。
- 不请求地址 API，不在工具事件中加入路由值。
- 为新增业务边界添加简洁中文注释。
- 不运行测试；格式、类型和构建检查由主代理在集成后统一执行。

禁止修改：

- 路由定义、地址页面/API、其他 Web 文件、API 文件、文档和测试文件。

## 子代理开始前检查

每个代理在编辑前须：

- 阅读设计、技术和 CRUD 契约中对应部分。
- 阅读所负责文件当前实现及相邻的偏好表单工具模式。
- 保留工作区已有改动；仅修改上列所有权文件。
- 不安装依赖、不新增 API/数据库结构、不运行测试或修改测试文件。

## 子代理完成报告

每个代理完成后报告：

```text
修改文件
执行命令（本阶段不得运行测试/构建）
静态检查结果
未解决风险
越界修改
```

## 主代理集成任务

- 核对 SSE 事件从工具回调、流式事件、Controller 编码到 Web parser/store/page 的类型与 payload 一致。
- 核对 JSON 聊天工具集合不含该工具，且普通地址咨询不会改变现有工具行为。
- 核对重复调用、异常输入、身份/会话切换及页面卸载的丢弃行为。
- 核对历史 mapper 隐藏调用/结果；trace 独立事件和嵌套模型调用均严格白名单投影。
- 核对显示 activity 不暴露输入/输出，新增事件及路由反馈不写消息、展示 envelope、长期记忆或数据库。
- 核对无地址模块依赖、HTTP 路由、Entity、Migration、Seeder、依赖或持久化状态变更。
- 审阅 `git diff` 与 `git diff --check`，运行格式、类型和构建检查；不运行测试，除非用户重新授权。

## 实施阶段

1. [x] 完成本文及设计、技术、CRUD 文档的状态和审批记录同步。
2. [x] A、B、C 按独占文件列表实现，不新增或运行测试。
3. [x] 主代理统一审阅跨层协议、生命周期、隐私投影与工作区差异，并完成格式、类型和构建检查。
4. [x] 留存待执行验证清单；用户重新授权后再运行对应自动化和浏览器验收。

## 验收标准

- [x] 仅 SSE 工具集合注册 `request_address_form`；JSON 聊天不注册。
- [x] 工具只接受 `{}`，固定结果不含地址、URL、身份标识或异常文本。
- [x] 同轮首次有效调用最多产生一个空 payload `address-form` 事件。
- [x] Web 只接受严格空对象事件，并固定导航到 `account-addresses`。
- [x] Web 请求绑定原会话和身份；失效上下文不触发导航。
- [x] Toast 反映实际导航结果，不把 `requested` 当作导航成功。
- [x] 历史恢复隐藏调用及结果；trace 仅保留白名单参数和结果。
- [x] 无地址 CRUD/API/数据库/迁移/依赖改动；本阶段未新增或运行测试。

## 风险和停止条件

- 如果现有一次性请求状态无法可靠识别页面离开、会话切换或身份切换，先采用丢弃请求的保守行为，不放宽校验。
- 如果 trace 的嵌套调用路径不能确认已覆盖，保持工具不可用或暂停该处修改，不保留未经白名单处理的原始 payload。
- 若实现需要修改本文件之外的共享基础设施或地址模块，暂停并向用户说明范围变化，不自行扩展。
- 自动化测试、真实模型调用及认证浏览器验收目前均为暂缓项，不计为通过；类型检查、格式检查和构建由主代理在实施集成后执行。

## 确认记录

- 2026-11-16：设计与 CRUD 契约已确认。
- 2026-11-16：用户确认技术方案，并要求直接完成文档后按实施文档实施；测试继续暂缓。
- 2026-11-16：A、B、C 已完成实现；API/Web 类型检查、API/Web 构建、Prettier 检查和 `git diff --check` 已通过。自动化测试、真实模型调用及登录态浏览器验收未执行。
