# clothesShoppingGuide

服装购物指南 Monorepo，使用 pnpm 原生 Workspace 管理前端、后端和共享模块。

## 环境

- Node.js 22 或以上，当前开发基线为 `.node-version` 中的版本。
- pnpm 12.14.0，与根目录 `package.json` 的 `packageManager` 保持一致。

## 目录

```text
apps/
  web/                        Vue 3 + Vite + shadcn-vue 前端
  api/                        NestJS + MikroORM + PostgreSQL 后端
packages/
  shared/                     共享模块骨架，目前没有业务实现
  typescript-config/          共享 TypeScript 编译配置
.github/workflows/ci.yml      安装、格式检查、类型检查和构建
```

## 常用命令

```bash
pnpm install --frozen-lockfile
pnpm dev:db
pnpm dev
pnpm check
pnpm migration:fresh
pnpm seed
pnpm seeder:create DatabaseSeeder
pnpm format
pnpm --filter @clothes-shopping-guide/shared build
```

`pnpm dev` 会并行启动前端和后端开发服务：前端地址为
`http://localhost:5173`，后端地址为 `http://localhost:3000`。首次启动或数据库容器
停止后，先执行 `pnpm dev:db` 启动 PostgreSQL；该命令只负责基础设施，不会启动应用进程。

`pnpm check` 依次执行格式检查、类型检查和构建；`pnpm seed` 会递归执行各应用的数据库 Seeder。`pnpm migration:fresh` 内置 `--drop-db --seed`，会删除并重建目标数据库、重跑迁移并执行默认 Seeder，也会清理不再映射到 Entity 的旧表，只应在可重建的本地或 CI 数据库中使用。`pnpm seeder:create DatabaseSeeder` 会在 `apps/api/src/database/seeders/` 生成 Seeder 类。后端业务测试通过 `pnpm --filter @clothes-shopping-guide/api test` 执行。

## 前端

前端位于 `apps/web`，使用 Vue 3、Vite、TypeScript、Vue Router、Tailwind CSS 4 和 shadcn-vue。开发服务默认监听 `0.0.0.0`，本地访问地址为 `http://localhost:5173`。shadcn-vue 组件按需通过 CLI 添加，组件源码归前端应用维护。

## 后端 API

后端位于 `apps/api`，使用 NestJS 12、MikroORM 7 和 PostgreSQL。复制 `apps/api/.env.example` 为 `.env` 后即可配置连接信息。

首次配置本地环境时执行：

```bash
cp apps/api/.env.example apps/api/.env
pnpm dev:db
pnpm migration:fresh
```

之后日常开发只需执行 `pnpm dev:db`（数据库未运行时）和 `pnpm dev`。`pnpm migration:fresh` 会清空数据库，仅用于明确可重建的本地或 CI 数据库。

健康检查地址为 `GET /api/health`。`migration:fresh` 会执行全部迁移并自动运行 `DatabaseSeeder`；单独执行 `pnpm seed` 只运行 Seeder。MikroORM CLI 使用 `tsx` 直接加载 TypeScript Entity，迁移和 Seeder 命令不依赖手工切换 loader。

## 用户与鉴权

用户模块位于 `apps/api/src/users`，认证模块位于 `apps/api/src/auth`。除健康检查、注册和登录外，接口都要求携带 `Authorization: Bearer <accessToken>`。

```text
POST  /api/auth/register  注册并返回 JWT
POST  /api/auth/login     登录并返回 JWT
POST  /api/auth/refresh   使用 HttpOnly Cookie 刷新 JWT
POST  /api/auth/logout    撤销当前 Refresh Token
GET   /api/auth/me        获取当前用户
GET   /api/users/me       获取当前资料
PATCH /api/users/me       修改昵称或密码
GET   /api/users          管理员查看用户列表
PATCH /api/users/:id      管理员修改角色、状态或昵称
DELETE /api/users/:id     管理员禁用用户
```

密码使用 `bcryptjs` 哈希后保存，API 响应不会返回密码；JWT Guard 每次请求都会重新读取用户状态，因此管理员禁用用户后其旧 Token 会立即失效。默认 Seeder 管理员账号由 `SEED_ADMIN_*` 环境变量控制，生产环境必须替换 `JWT_SECRET` 和默认密码。完整字段、权限和错误契约见 [`docs/contracts/user-crud-contract.md`](./docs/contracts/user-crud-contract.md)。

## 新增模块

在 `apps/<应用名>` 或 `packages/<模块名>` 中创建独立的 `package.json`。内部包使用 `@clothes-shopping-guide/` 命名空间，不需要发布的包设置 `"private": true`。

依赖共享包时使用 Workspace 协议：

```bash
pnpm --filter <应用包名> add '@clothes-shopping-guide/shared@workspace:*'
pnpm --filter <应用包名> add -D '@clothes-shopping-guide/typescript-config@workspace:*'
```

Node.js 模块可继承 `@clothes-shopping-guide/typescript-config/base.json`；前端框架接入时应根据其官方要求增加专用配置。共享包只通过公开入口提供能力，避免应用之间或跨包引用私有源码。

根目录通过 pnpm 递归执行各包的 `build` 和 `typecheck` 脚本，按依赖关系处理顺序。应用开发服务由各应用自行提供，未初始化业务应用前不设置空的启动脚本。
