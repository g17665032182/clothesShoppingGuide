# 业务模块文档

[返回文档总览](../README.md)

所有业务模块文档集中在本目录。模型、系统上下文和工具增量见 [LLM 专题索引](./llm/README.md)，结构化偏好与 Markdown 记忆见[偏好记忆专题索引](./user-memory/README.md)。

## 业务文档

表中的“—”表示没有单独文件，不代表该阶段已完成或可以跳过审批。多轮增量按各自主题列出；LLM 和偏好记忆的完整文档在专题索引中。

| 业务             | PRD                                               | 设计                                                                | 技术                                                                   | 实施与验收                                                                  |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 登录验证码       | —                                                 | [设计](./auth/login-captcha-design.md)                              | [技术](./auth/login-captcha-technical.md)                              | [实施](./auth/login-captcha-implementation.md)                              |
| 商品目录与导购   | —                                                 | [设计](./product-guide/product-guide-design.md)                     | [技术](./product-guide/product-catalog-technical.md)                   | [实施](./product-guide/product-catalog-implementation.md)                   |
| 管理员运营       | [PRD](./admin-management/admin-management-prd.md) | [设计](./admin-management/admin-management-design.md)               | [技术](./admin-management/admin-management-technical.md)               | [实施](./admin-management/admin-management-implementation.md)               |
| 收货地址簿       | —                                                 | [设计](./user-addresses/user-addresses-design.md)                   | [技术](./user-addresses/user-addresses-technical.md)                   | [实施](./user-addresses/user-addresses-implementation.md)                   |
| 订单             | [PRD](./orders/order-module-prd.md)               | [设计](./orders/order-module-design.md)                             | [技术](./orders/order-module-technical.md)                             | [实施](./orders/order-module-implementation.md)                             |
| 聊天记录         | —                                                 | [设计](./chat-records/chat-records-design.md)                       | [技术](./chat-records/chat-records-technical.md)                       | [实施](./chat-records/chat-records-implementation.md)                       |
| 流式聊天         | —                                                 | [设计](./chat-streaming/chat-streaming-design.md)                   | [技术](./chat-streaming/chat-streaming-technical.md)                   | [实施](./chat-streaming/chat-streaming-implementation.md)                   |
| AI 对话界面      | —                                                 | [设计](./chat-streaming/ai-elements-design.md)                      | [技术](./chat-streaming/ai-elements-technical.md)                      | [实施](./chat-streaming/ai-elements-implementation.md)                      |
| 聊天卡片         | —                                                 | [设计](./chat-card-display/chat-card-display-design.md)             | [技术](./chat-card-display/chat-card-display-technical.md)             | [实施](./chat-card-display/chat-card-display-implementation.md)             |
| 聊天用户信息查询 | —                                                 | [设计](./chat-user-information/chat-user-information-design.md)     | [技术](./chat-user-information/chat-user-information-technical.md)     | [实施](./chat-user-information/chat-user-information-implementation.md)     |
| 聊天动态表单     | —                                                 | [设计](./chat-dynamic-form/chat-dynamic-form-design.md)             | [技术](./chat-dynamic-form/chat-dynamic-form-technical.md)             | [实施](./chat-dynamic-form/chat-dynamic-form-implementation.md)             |
| 聊天购买         | [PRD](./chat-purchase/chat-purchase-prd.md)       | [设计](./chat-purchase/chat-purchase-design.md)                     | [技术](./chat-purchase/chat-purchase-technical.md)                     | [实施](./chat-purchase/chat-purchase-implementation.md)                     |
| 聊天取消订单     | —                                                 | [设计](./chat-order-cancellation/chat-order-cancellation-design.md) | [技术](./chat-order-cancellation/chat-order-cancellation-technical.md) | [实施](./chat-order-cancellation/chat-order-cancellation-implementation.md) |
| 虚拟试穿         | [PRD](./virtual-try-on/virtual-try-on-prd.md)     | [设计](./virtual-try-on/virtual-try-on-design.md)                   | [技术](./virtual-try-on/virtual-try-on-technical.md)                   | [实施](./virtual-try-on/virtual-try-on-implementation.md)                   |
| 商品试穿配置     | —                                                 | [设计](./virtual-try-on/product-try-on-setting-design.md)           | [技术](./virtual-try-on/product-try-on-setting-technical.md)           | [实施](./virtual-try-on/product-try-on-setting-implementation.md)           |
| 聊天试穿工具     | —                                                 | [设计](./chat-try-on/chat-try-on-design.md)                         | [技术](./chat-try-on/chat-try-on-technical.md)                         | [实施](./chat-try-on/chat-try-on-implementation.md)                         |

补充说明：

- [聊天后台生成](./chat-streaming/background-generation.md)：跨会话、跨路由生成的范围、技术边界和验收要求。
- [公开试穿测试素材](./virtual-try-on/fixtures/README.md)：测试图片、来源、许可及摘要；素材保留在所属业务目录。
