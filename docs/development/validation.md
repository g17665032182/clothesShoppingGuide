# 环境与验证约定

执行测试、迁移、数据库或运行时验收前阅读本指南；全量任务再按需查阅 [`../testing/project-full-validation-plan.md`](../testing/project-full-validation-plan.md)。

## 环境与数据安全

- 统一使用 pnpm。日常开发使用 `pnpm dev:db`、`pnpm dev`；API、ORM CLI 和 Seeder 配置优先级为进程环境变量 > 根目录 `.env.dev` > 根目录 `.env`。不打印真实密钥、Token、密码或完整环境文件。
- 开发环境明确设置 `NODE_ENV=development`；登录验证码在开发环境关闭、测试和生产环境启用，不为测试便利改变生产规则。
- 保留数据的库使用 `pnpm --filter @clothes-shopping-guide/api migration:up`。`migration:fresh` 包含删库重建，仅用于明确可销毁的本地或 CI 库。默认 Seeder 只建管理员；测试商品单独运行 `catalog:seed:test`。
- PostgreSQL、迁移及数据库 HTTP 测试必须使用具名、可销毁且不同于默认开发库的隔离库。执行前检查测试源码的 `RUN_*` 门控、实际消费的变量、派生库名和初始化/清理逻辑；无法确认目标和清理范围时不运行。
- 同库初始化、迁移、集成测试与清理必须串行；只有确认数据库完全隔离后才考虑并行。共享端口、数据库、容器、会话或构建目录的任务不得并行争用。
- 测试只清理本轮创建的进程、容器、数据库、快照和文件，不清理用户已有环境。

## 验证与报告

- `pnpm check` 包含格式、递归类型检查和构建，不包含 API 测试。API 测试需单独运行。Web 当前没有项目内单元/组件或浏览器测试脚本，类型检查和构建不是交互验收。
- 后端至少执行 `pnpm format:check`、`pnpm --filter @clothes-shopping-guide/api typecheck`、`pnpm --filter @clothes-shopping-guide/api test`、`pnpm --filter @clothes-shopping-guide/api build`、`pnpm check`；共享构建输出的命令串行运行。
- 迁移验证覆盖升级、历史数据保留、回滚及再次升级；审查真实迁移集合与顺序、反向外键和 down 删除顺序。测试不能只用固定迁移数量代替兼容性断言。
- 数据库测试替身应遵守生产调用契约。聊天图中的动态工具经 graph factory 装配；最终回复关联有效模型 trace。多轮数据库测试应模拟请求级 EntityManager 边界，不通过放宽业务断言掩盖 fixture 问题。
- 验证记录给出命令、通过/失败/跳过数量、隔离库及清理结果，并明确浏览器认证流程、移动端、外部供应商的实际覆盖。门控关闭而 skipped 的用例记为未验证；不得把计划、代码审查、构建或局部测试写成端到端通过。
