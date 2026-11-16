# 项目开发约定

本仓库是 pnpm Monorepo：`apps/web` 为 Vue 3、Vite、shadcn-vue 前端；`apps/api` 为 NestJS、MikroORM、PostgreSQL 和 LangGraph 后端。实际依赖和命令以各包 `package.json` 为准。

## 通用规则

- 开始工作前检查 `git status`，阅读相关业务契约、实施记录和当前源码。保留已有修改、环境配置和私有图片；设计稿、计划或旧实施记录不代表当前代码状态。
- 优先复用本地依赖和公开模块入口；新增依赖前阅读本地文档并确认确有必要。模块保持高内聚、低耦合，跨模块不得依赖私有实现。
- 统一使用 pnpm；仓库内部依赖使用 `workspace:*`。必要的新增代码注释使用中文，解释业务规则、设计意图和复杂逻辑。
- 资源、字段、权限或 API 行为变化，先更新对应 `docs/contracts/` 契约；存在影响数据、授权或兼容性的歧义时先标记“待确认”，确认前不改 Entity、校验、授权或迁移。
- 功能、配置、命令或开发流程变化时，同步维护 README 和相关专题文档。报告必须区分已实现、已验证、失败、跳过和未执行。
- 简单或强耦合的任务由主代理完成；较大且可独立拆分的工作可按文件/模块分工。主代理负责审阅集成结果并执行最终验证；共享数据库、端口和构建目录的任务须隔离或串行。

## 按需阅读

- 文档总入口见 [`docs/README.md`](docs/README.md)，按业务和文档阶段查找；新增或迁移文档时同步维护索引与引用。
- 同一业务的需求、设计、技术和实施文档统一放在 `docs/modules/<业务名>/`；资源契约仍集中在 `docs/contracts/`，共用开发规范和跨模块验证分别放在 `docs/development/` 与 `docs/testing/`。
- 前端页面、组件、路由、API 或状态管理：先读 [`docs/development/frontend.md`](docs/development/frontend.md)。
- NestJS API、Zod、MikroORM、契约或迁移：先读 [`docs/development/backend.md`](docs/development/backend.md)。
- LLM 工具、聊天、地址、订单、取消订单或试穿隐私边界：先读 [`docs/development/security-and-business-boundaries.md`](docs/development/security-and-business-boundaries.md)，再读对应契约。
- 测试、数据库、迁移验证、运行环境或验收报告：先读 [`docs/development/validation.md`](docs/development/validation.md) 和 [`docs/testing/project-full-validation-plan.md`](docs/testing/project-full-validation-plan.md) 中相关部分。
- 较大业务模块按需求阶段推进时，使用 `.agents/skills/module-development-workflow/` 工作流；不重复询问已确认的决策。

没有涉及的领域文档无需读取。API 使用原生 ESM；现有 TypeScript 相对导入保留 `.js` 后缀。
