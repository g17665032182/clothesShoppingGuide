# 用户偏好与记忆文档

[返回文档总览](../README.md)

结构化穿衣偏好与 Markdown 长期记忆属于独立资源。先读[用户偏好契约](../contracts/user-preferences-crud-contract.md)和[用户记忆契约](../contracts/user-memory-crud-contract.md)，再结合完整拆分及后续增量理解当前边界。

## 拆分与后续增量

| 主题                   | 设计                                                  | 技术                                                     | 实施与验收                                                    |
| ---------------------- | ----------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| 偏好与记忆完整拆分     | [设计](./user-preference-memory-separation-design.md) | [技术](./user-preference-memory-separation-technical.md) | [实施](./user-preference-memory-separation-implementation.md) |
| 会话批量提取           | [设计](./user-memory-session-extraction-design.md)    | [技术](./user-memory-session-extraction-technical.md)    | [实施](./user-memory-session-extraction-implementation.md)    |
| 长期背景与偏好维护边界 | [设计](./user-memory-background-design.md)            | [技术](./user-memory-background-technical.md)            | [实施](./user-memory-background-implementation.md)            |

聊天购买及各类只读查询的来源隔离增量记录在用户记忆契约中；应连同[对话工具文档](../llm/README.md)及对应实施记录阅读。各文件保留当时的验证状态，后续数据库及浏览器复测另见[测试文档](../testing/README.md)。

## 历史混合方案

以下文件保留此前偏好与记忆混合方案的背景。共用模块、开关、任务及提取方案已被完整拆分及后续增量取代，不作为当前实现方案。

| 主题             | 设计                                | 技术                                   | 实施记录                                    |
| ---------------- | ----------------------------------- | -------------------------------------- | ------------------------------------------- |
| 早期用户长期记忆 | [历史设计](./user-memory-design.md) | [历史技术](./user-memory-technical.md) | [历史实施](./user-memory-implementation.md) |
