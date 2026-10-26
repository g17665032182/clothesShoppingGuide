# clothesShoppingGuide

服装购物指南的 Monorepo 基础仓库，使用 pnpm 原生 Workspace 管理应用和共享模块。

## 环境

- Node.js 22 或以上，当前开发基线为 `.node-version` 中的版本。
- pnpm 12.14.0，与根目录 `package.json` 的 `packageManager` 保持一致。

## 目录

```text
apps/                         独立应用，尚未绑定业务框架
  api/                        NestJS + MikroORM + PostgreSQL 后端
packages/
  shared/                     共享模块骨架，目前没有业务实现
  typescript-config/          共享 TypeScript 编译配置
.github/workflows/ci.yml      安装、格式检查、类型检查和构建
```

## 常用命令

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm migration:fresh
pnpm seed
pnpm seeder:create DatabaseSeeder
pnpm format
pnpm --filter @clothes-shopping-guide/shared build
pnpm --filter @clothes-shopping-guide/api start:dev
```

`pnpm check` 依次执行格式检查、类型检查和构建；`pnpm seed` 会递归执行各应用的数据库 Seeder。`pnpm migration:fresh` 内置 `--seed`，会清空本地数据库、重跑迁移并执行默认 Seeder，只应在可重建的本地或 CI 数据库中使用。`pnpm seeder:create DatabaseSeeder` 会在 `apps/api/src/database/seeders/` 生成 Seeder 类。当前没有业务逻辑和测试用例；新增功能时应在所属包中补充测试及 `test` 脚本，并接入 CI。

## 后端 API

后端位于 `apps/api`，使用 NestJS 12、MikroORM 7 和 PostgreSQL。复制 `apps/api/.env.example` 为 `.env` 后即可配置连接信息。

```bash
cp apps/api/.env.example apps/api/.env
docker compose -f apps/api/docker-compose.yml up -d
pnpm --filter @clothes-shopping-guide/api migration:up
pnpm migration:fresh
pnpm --filter @clothes-shopping-guide/api start:dev
```

健康检查地址为 `GET /api/health`。`migration:fresh` 会执行全部迁移并自动运行 `DatabaseSeeder`；单独执行 `pnpm seed` 只运行 Seeder。当前没有业务 Entity，因此入口暂时为空，后续可在 `apps/api/src/database/seeders/DatabaseSeeder.ts` 中加入初始化数据。业务资源的 Entity、DTO 和 CRUD 路由需要先按契约文档确认后再增加。

## 新增模块

在 `apps/<应用名>` 或 `packages/<模块名>` 中创建独立的 `package.json`。内部包使用 `@clothes-shopping-guide/` 命名空间，不需要发布的包设置 `"private": true`。

依赖共享包时使用 Workspace 协议：

```bash
pnpm --filter <应用包名> add '@clothes-shopping-guide/shared@workspace:*'
pnpm --filter <应用包名> add -D '@clothes-shopping-guide/typescript-config@workspace:*'
```

Node.js 模块可继承 `@clothes-shopping-guide/typescript-config/base.json`；前端框架接入时应根据其官方要求增加专用配置。共享包只通过公开入口提供能力，避免应用之间或跨包引用私有源码。

根目录通过 pnpm 递归执行各包的 `build` 和 `typecheck` 脚本，按依赖关系处理顺序。应用开发服务由各应用自行提供，未初始化业务应用前不设置空的启动脚本。
