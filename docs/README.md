# 项目文档

本文是 `docs/` 的统一入口。环境准备、启动和常用命令见[项目 README](../README.md)，开发约定见 [AGENTS.md](../AGENTS.md)。

## 按任务查找

| 任务                             | 入口                                          |
| -------------------------------- | --------------------------------------------- |
| 了解产品需求与阶段范围           | [产品 PRD](./product/prd.md)及下方各业务 PRD  |
| 开发前查阅规范                   | [开发文档索引](./development/README.md)       |
| 确认 API、字段、权限和兼容边界   | [业务契约索引](./contracts/README.md)         |
| 查阅模型、上下文与对话工具       | [LLM 文档索引](./llm/README.md)               |
| 查阅结构化偏好与 Markdown 记忆   | [偏好与记忆文档索引](./user-memory/README.md) |
| 查找验证计划、执行证据与剩余缺口 | [测试文档索引](./testing/README.md)           |

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

## 阅读与维护

- 文档按业务放在 `docs/<业务名>/`；共用开发规范放在 `development/`，资源契约集中在 `contracts/`，跨模块验证记录放在 `testing/`。
- PRD 记录需求范围，`*-design.md` 记录业务设计，`*-technical.md` 记录技术方案，`*-implementation.md` 记录实施安排及实际交付证据。目录中存在文件不表示已审批、已实现或已验证。
- 先读当前契约和对应增量，再结合源码、实施记录及带日期的复测结果判断状态。历史 PRD、设计和旧检查清单不能单独作为当前完成度依据。
- 保留历史审批、失败及受阻记录；后续复测按日期追加证据，不将局部通过改写为全量验收通过。
- 新增或迁移文件时，同步更新本索引、所属专题索引及仓库内引用；保留已有业务文件路径，只有归属明确不当时才迁移。
