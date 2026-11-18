# LLM 与对话工具文档

[返回文档总览](../../README.md)

先通过[对话工具能力清单](./chat-tool-capability-inventory.md)了解工具范围，再阅读对应契约和阶段文档。各阶段的审批、实施及验证状态以对应记录为准。

## 模型与上下文

| 主题                 | 设计                                         | 技术                                            | 实施与验收                                           |
| -------------------- | -------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| 通用大模型模块       | [设计](./llm-module-design.md)               | [技术](./llm-module-technical.md)               | [实施](./llm-module-implementation.md)               |
| 后端系统上下文       | [设计](./system-context-design.md)           | [技术](./system-context-technical.md)           | [实施](./system-context-implementation.md)           |
| 节点级聊天历史持久化 | [设计](./chat-history-persistence-design.md) | [技术](./chat-history-persistence-technical.md) | [实施](./chat-history-persistence-implementation.md) |

## 对话工具增量

| 主题                             | 设计                                            | 契约                                                                 | 技术                                               | 实施与验收                                              |
| -------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| 工具扩展规划与首期试穿任务查询   | [设计](./chat-tool-expansion-design.md)         | [契约](../../contracts/chat-tool-expansion-crud-contract.md)         | [技术](./chat-tool-expansion-technical.md)         | [实施](./chat-tool-expansion-implementation.md)         |
| 第二阶段：精确规格与本人偏好查询 | [设计](./chat-tool-phase-two-design.md)         | [扩展契约](../../contracts/chat-tool-expansion-crud-contract.md)     | [技术](./chat-tool-phase-two-technical.md)         | [实施](./chat-tool-phase-two-implementation.md)         |
| 偏好管理界面请求                 | [设计](./chat-tool-preference-form-design.md)   | [契约](../../contracts/chat-tool-preference-form-crud-contract.md)   | [技术](./chat-tool-preference-form-technical.md)   | [实施](./chat-tool-preference-form-implementation.md)   |
| 地址管理界面请求                 | [设计](./chat-tool-address-form-design.md)      | [契约](../../contracts/chat-tool-address-form-crud-contract.md)      | [技术](./chat-tool-address-form-technical.md)      | [实施](./chat-tool-address-form-implementation.md)      |
| 本人订单履约摘要                 | [设计](./chat-tool-order-fulfillment-design.md) | [契约](../../contracts/chat-tool-order-fulfillment-crud-contract.md) | [技术](./chat-tool-order-fulfillment-technical.md) | [实施](./chat-tool-order-fulfillment-implementation.md) |
| 本站购物规则查询                 | [设计](./chat-tool-shopping-rules-design.md)    | [契约](../../contracts/chat-tool-shopping-rules-crud-contract.md)    | [技术](./chat-tool-shopping-rules-technical.md)    | [实施](./chat-tool-shopping-rules-implementation.md)    |
| 近 3 天天气查询                  | [设计](./chat-tool-weather-design.md)           | [契约](../../contracts/chat-tool-weather-crud-contract.md)           | [技术](./chat-tool-weather-technical.md)           | [实施](./chat-tool-weather-implementation.md)           |

## 相关业务

- 展示、动态表单、用户信息、购买、取消和试穿工具的文档保留在各自业务目录，入口见[业务文档总表](../../README.md)。
- 结构化偏好和 Markdown 长期记忆见[专题索引](../user-memory/README.md)。
- 工具权限与数据投影先读[安全与业务边界](../../development/security-and-business-boundaries.md)，跨模块复测见[测试文档](../../testing/README.md)。
