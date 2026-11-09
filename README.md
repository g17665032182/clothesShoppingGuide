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

### 聊天购买与我的订单

启用账号登录后，可以从聊天商品卡的“购买”入口创建本会话草稿，选择真实规格、补全收货信息，再通过“确认下单”按钮创建本站订单。助手只能准备、修改或放弃草稿，不能替用户执行正式订单动作。

`/account/orders` 提供本人订单列表、筛选、详情、模拟支付、取消待支付订单和确认收货；聊天订单卡也可打开共享订单详情。模拟支付不产生真实扣款。草稿最后有效修改后 24 小时失效，订单沿用 30 分钟支付期；重试和网络未知结果应先读取服务端状态，不另起订单。草稿收货信息不进入长期记忆或下次购买默认地址，用户主动发送的聊天原文仍按现有规则保存。

本轮新增 `Migration20261108044411`，只增加购买草稿及消息来源资格，不清理历史商品、聊天、订单或幂等数据。保留数据的环境应按既有流程备份、审查并执行增量迁移，不使用 `migration:fresh`。本轮验证仅操作具名可销毁测试库，没有迁移默认数据库。功能、测试及未完成浏览器验收详见[购买实施记录](./docs/chat-purchase/chat-purchase-implementation.md)。

### 管理员入口

启用的管理员登录后，可从用户菜单进入 `/admin/products`（商品目录）、
`/admin/orders`（订单履约）或原有 `/admin/users`（用户管理）。
商品只读，支持分页筛选、SKU 详情和精确库存；订单支持分页筛选、收货/物流详情，
以及待发货订单整单发货。不提供商品编辑、上下架、库存修改或订单改价/退款。
页面与接口均受管理员权限保护；完整约定见
[管理员运营契约](./docs/contracts/admin-management-crud-contract.md)。

### 本地试穿测试

开发环境使用服务端 SHA-256 白名单限制测试照片。已准备一张
[公开试穿测试图片](./docs/virtual-try-on/fixtures/public-model.webp)，来源、许可证、
规范化摘要及使用步骤见[测试图片说明](./docs/virtual-try-on/fixtures/README.md)。
从服装商品卡进入“我的试穿”后，可选择该原始 WebP 文件验证上传。
完整生成还需配置证书有效的七牛 HTTPS 下载域名；当前本地测试域名证书不匹配，
上传成功不代表生成链路已经可用。
渠道凭据只在后端本地配置；真实用户照片限制继续生效。

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
