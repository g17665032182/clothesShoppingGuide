# 业务契约

[返回文档总览](../README.md)

本目录集中维护资源、字段、校验、权限、响应、迁移和兼容边界。实现与验证状态请结合契约正文、[业务实施记录](../README.md)和[分日期测试证据](../testing/README.md)核对。

## 账号与个人资源

| 契约                                                              | 范围                                            |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| [用户与认证](./user-crud-contract.md)                             | 注册、登录、鉴权、个人资料和管理员用户管理      |
| [收货地址](./user-address-crud-contract.md)                       | 本人地址簿、默认地址和删除行为                  |
| [用户偏好](./user-preferences-crud-contract.md)                   | 结构化穿衣偏好、独立开关和用户维护              |
| [用户记忆](./user-memory-crud-contract.md)                        | Markdown 长期记忆、批量提取和聊天来源隔离       |
| [个性化商品与穿搭推荐](./fashion-recommendation-crud-contract.md) | 商品/穿搭推荐引用、推荐反馈、派生画像和学习设置 |

## 商品、订单与运营

| 契约                                                      | 范围                                     |
| --------------------------------------------------------- | ---------------------------------------- |
| [商品目录](./product-catalog-crud-contract.md)            | 商品/SKU、导入、推荐及订单库存协作       |
| [订单](./order-crud-contract.md)                          | 下单、模拟支付、库存、履约和查询         |
| [退货退款](./return-refund-crud-contract.md)              | 本人退货退款申请、订单页流程与管理员审核 |
| [管理员运营](./admin-management-crud-contract.md)         | 管理员商品、库存、订单查询和整单发货     |
| [虚拟试穿](./virtual-try-on-crud-contract.md)             | 照片资产、后台任务、本人结果与隐私边界   |
| [商品试穿配置](./product-try-on-setting-crud-contract.md) | 商品试穿开关、资格和图片配置             |

## 聊天与交互

| 契约                                                       | 范围                                       |
| ---------------------------------------------------------- | ------------------------------------------ |
| [聊天记录](./chat-records-crud-contract.md)                | 会话、公开消息及访问权限                   |
| [流式聊天](./chat-streaming-crud-contract.md)              | SSE、生成状态、停止及持久化边界            |
| [聊天卡片展示](./chat-card-display-crud-contract.md)       | 通用卡片协议、模板分发、数据来源和历史兼容 |
| [用户信息查询](./chat-user-information-crud-contract.md)   | 本人信息查询、安全摘要与前端临时读取       |
| [动态表单](./chat-dynamic-form-crud-contract.md)           | 表单请求、字段约束及用户提交边界           |
| [聊天购买](./chat-purchase-crud-contract.md)               | 商品卡购买、草稿、地址选择及确认下单       |
| [聊天取消订单](./chat-order-cancellation-crud-contract.md) | 可取消订单查询、用户选择和二次确认         |
| [聊天试穿工具](./chat-try-on-tool-contract.md)             | 商品触发、本人照片同意、生图及安全展示     |

## 对话工具增量

| 契约                                                               | 范围                                             |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| [工具扩展](./chat-tool-expansion-crud-contract.md)                 | 首期试穿任务查询及第二阶段精确规格、本人偏好查询 |
| [偏好管理界面请求](./chat-tool-preference-form-crud-contract.md)   | 请求打开固定偏好管理视图                         |
| [地址管理界面请求](./chat-tool-address-form-crud-contract.md)      | 请求打开固定本人地址管理页                       |
| [本人订单履约摘要](./chat-tool-order-fulfillment-crud-contract.md) | 本地订单状态和时间，无实时物流                   |
| [本站购物规则查询](./chat-tool-shopping-rules-crud-contract.md)    | 既有系统规则、固定来源和版本                     |
| [聊天天气查询](./chat-tool-weather-crud-contract.md)               | 按用户指定城市查询近 3 天预报的模型工具          |

对应设计、技术与实施记录见 [LLM 文档索引](../modules/llm/README.md)。

新增业务资源前，请参考 [CRUD 契约模板](../../.agents/skills/nestjs-mikroorm-crud/references/crud-contract.md)在本目录创建契约，完成字段、权限、分页、删除行为和迁移兼容性确认后再实现，并更新本索引。
