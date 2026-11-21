# 开发文档

[返回文档总览](../README.md)

首次接手先看 [Agent 项目速读](./agent-guide.md)，按任务定位源码与契约，再选择下方领域规范。

| 文档                                                           | 适用任务                                          |
| -------------------------------------------------------------- | ------------------------------------------------- |
| [前端开发约定](./frontend.md)                                  | Vue 页面、组件、路由、API 适配和状态管理          |
| [前端操作反馈](./frontend-feedback.md)                         | Toast、错误展示、表单保留、重复提示和结果未知状态 |
| [后端开发约定](./backend.md)                                   | NestJS、Zod、MikroORM、接口分层和迁移             |
| [安全与业务边界](./security-and-business-boundaries.md)        | 聊天工具、地址、购买、订单、取消及试穿隐私        |
| [环境与验证约定](./validation.md)                              | 环境配置、隔离数据库、测试门控和报告要求          |
| [Render 与 Neon 部署](./deployment.md)                         | Render Blueprint、Neon 连接、迁移、Seeder 和回滚  |
| [多人协作与 Kubernetes 发布设计](./ci-cd-kubernetes-design.md) | 分支、CI/CD、容器化、Redis 验证码和切流           |

仓库通用规则见 [AGENTS.md](../../AGENTS.md)，较大业务模块按[模块开发工作流](../../.agents/skills/module-development-workflow/SKILL.md)分阶段推进。开发前结合[业务契约](../contracts/README.md)和[对应业务文档](../README.md)读取，不以历史计划替代当前代码与验收证据。
