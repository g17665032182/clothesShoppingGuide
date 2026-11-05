# 长期背景与偏好维护边界实施文档

## 状态与审批

- 状态：待用户确认；尚未开始实现。
- 设计、两个资源契约及技术方案已确认。
- 确认本实施文档后才修改业务代码、测试和前端；不新增数据库 migration，不改写账号数据。
- 技术决策：[长期背景与偏好维护边界技术方案](./user-memory-background-technical.md)。

## 实施目标

- 结构化偏好只能通过现有用户 CRUD 修改，聊天及后台任务不再写入偏好。
- 保留偏好数据、来源、任务历史及原 CRUD；偏好开关只决定聊天是否读取偏好。
- 长期记忆为开放 Markdown，提取明确表达的穿衣相关长期背景，并改善这些背景在穿衣推荐中的有限召回。
- 两个领域继续独立运行；关闭或失败一个领域不影响另一个领域和普通聊天。

## 修改范围与文件所有权

### 聊天与偏好后端

- `apps/api/src/chat-records/service/chat-records.service.ts`：持久化聊天只登记 Markdown 记忆任务；移除偏好自动任务入队。
- `apps/api/src/user-preferences/user-preferences.module.ts`：停止注册自动偏好 scheduler/extractor providers，不导入不再需要的聊天来源模块。
- `apps/api/src/user-preferences/port/user-preferences.port.ts` 与 `index.ts`：移除自动任务入队 token、类型和接口；保留 reader 与 conversation lifecycle 公开能力。
- `apps/api/src/user-preferences/service/user-preference-task.service.ts`：保留历史任务实体兼容所需内容时，删除自动领取、候选生成、恢复和重试运行能力；具体保留程度以无消费者引用及构建结果为准。
- `apps/api/src/user-preferences/service/user-preference-scheduler.service.ts`、`user-preference-extractor.service.ts`：移除已停用的自动执行模块。
- `apps/api/src/user-preferences/service/user-preferences.service.ts`：删除全部偏好时只处理偏好记录，不清除 pending、processing、failed 历史任务或结果。
- `apps/api/src/user-preferences/service/user-preference-reader.service.ts`：继续以独立设置决定是否注入；不允许 LLM 输出触发偏好写操作。
- `apps/api/src/user-preferences/spec/`、`apps/api/src/chat-records/spec/`：调整单元、HTTP 和 PostgreSQL 测试，确保仅有记忆任务登记，偏好历史任务不被执行或删除。

### Markdown 记忆后端

- `apps/api/src/user-memory/service/user-memory-extractor.service.ts`：更新提示和 fake 模型测试；允许记忆穿衣相关的时段/季节、地区/气候、长期活动和爱好等自由文本，不映射类别、不修改偏好；排除临时事件和模型推测。
- `apps/api/src/user-memory/service/user-memory-reader.service.ts`：实现技术方案规定的有限穿衣背景召回，非穿衣请求不额外召回；保留相关段落选择、顺序、长度和 token 上限。
- `apps/api/src/user-memory/spec/user-memory-extractor.service.spec.ts`、`user-memory-reader.service.spec.ts`：覆盖提示输入、开放文本写入、相关背景召回、无关请求、敏感内容、关闭开关与长度限制。
- 不修改候选 schema、文档 API、七牛对象格式、文档 revision/generation 和清空语义。

### Web 与契约

- `apps/web/src/pages/memories/index.vue` 及页面私有偏好状态：把开关文案改为“参考我的偏好”，保持现有加载、提交、错误和关闭状态。
- `apps/web/src/api/modules/preferences.ts`、`apps/web/src/api/types/preferences.ts`：除非类型或请求语义确需调整，不改已稳定的 API 契约。
- 更新 [用户偏好 CRUD 契约](../contracts/user-preferences-crud-contract.md)、[用户记忆 CRUD 契约](../contracts/user-memory-crud-contract.md)、[设计](./user-memory-background-design.md)、[技术方案](./user-memory-background-technical.md) 的实际交付记录与验收状态；仅报告真实完成的步骤。
- 仅主代理维护跨模块接线、聊天服务、模块注册、共享契约和最终集成；不启用子代理并行修改，以避免所有权交叠。

## 按序实施

1. 建立当前工作树和专用测试数据库基线；确认所有执行进程和数据库配置，不对日常库执行 `migration:fresh`。先增加/调整 fake 与专用 PostgreSQL 测试。
2. 移除聊天对偏好任务的自动入队，并取消偏好 scheduler/extractor 注册；保留偏好 CRUD、reader、settings、来源生命周期和历史任务表/实体所需兼容代码。
3. 改为偏好开关只控制读取；更新删除全部行为，保证任何偏好用户操作不删除历史任务及结果。
4. 更新结构化 Markdown 记忆提取提示，并实现有限穿衣背景召回；分别验证候选应用和上下文使用，不声称关键词/线索匹配等价于通用语义检索。
5. 更新 Web 开关文案和相关状态测试；确认记忆开关、偏好开关、手动 CRUD 互不影响。
6. 运行定向测试、API 全量测试、类型检查、构建和仓库检查，审查 diff 与文件边界。
7. 在兼容窗口安排停写切换：停止全部旧版 API/worker；确认 scheduler 已停止、正在执行的模型调用已退出、旧数据库写事务结束；部署并验证新版本后才恢复流量。禁止新旧混跑，不回滚历史偏好；若需回滚，旧偏好 worker 必须保持关闭。
8. 进行本地 HTTP smoke：手动偏好 CRUD、设置开关两种状态、聊天只新增 Markdown 记忆任务、记忆更新与读取及用户隔离。外部模型和七牛不可用时以可控 fake 测试覆盖，并如实记录未执行 smoke。
9. 记录实现文件、无 migration 决策、测试数据库、命令及结果、切换限制和未解决风险。

## 验收清单

- [ ] API 聊天保存路径不再登记偏好提取任务；记忆任务独立登记和 flush 行为无回归。
- [ ] 新版本不注册或运行偏好 scheduler/extractor；历史偏好任务、结果不被领取、修改、删除或伪标完成。
- [ ] 手动创建、修改、删除及删除全部继续工作，保留原校验、权限、去重和来源规则。
- [ ] `enabled=false` 时手动维护仍可用、聊天不注入；`enabled=true` 时结构化偏好只作为只读参考。
- [ ] 偏好开关仅名为“参考我的偏好”；Markdown 记忆开关保持独立。
- [ ] Markdown 候选可以表达开放的时段、季节、粗粒度地点/气候、爱好和重复活动，不绑定结构化类别。
- [ ] 单次日期/天气/旅行、助手推测、设备/IP 地点不成为长期用户事实；详细地址及现有敏感信息仍被拒绝。
- [ ] 穿衣推荐可以召回相关背景；无关聊天不因此注入整篇文档；字数/token 预算、段落顺序和用户隔离通过测试。
- [ ] 不新增依赖、数据库字段或 migration；记忆任务和偏好手动操作互不耦合。
- [ ] 切换过程确认旧 worker 和事务完全结束，无新旧版本混跑。
- [ ] API 定向和全量测试、typecheck/build、`pnpm format:check`、`pnpm check`、`git diff --check` 均实际执行并记录。

## 风险与停止条件

- 旧版 worker 必须停干净才能保证其已领取任务不会在切换后提交；若无法确认进程或事务状态，暂停上线，不声称旧任务已阻断。
- 历史任务保留但不执行，管理面仍可能显示旧状态；本期不增任务历史管理 API/UI，也不伪造新状态。
- 自由文本中的地点、气候或爱好表达存在歧义；有限线索召回必须以测试约束，召回不足时不引入依赖或隐藏无边界全库注入。
- 不修改用户既有数据、聊天记录、文档对象和数据库历史迁移；不清空队列来绕过停写要求。
- 若测试要求改变 API、持久化结构、已确认的敏感信息策略或历史数据语义，停止并回到设计/技术审批。

## 实施报告模板

实施完成后补充实际记录：

- 修改文件与行为：
- 数据库及部署切换：
- 执行命令和结果：
- HTTP/browser smoke：
- 未执行项目与限制：
- 剩余风险：
