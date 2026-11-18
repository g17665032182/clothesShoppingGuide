# Render 与 Neon 部署

[返回开发文档索引](./README.md) · [返回项目文档总览](../README.md)

核对日期：2026-11-18。当前生产部署使用 GitHub 仓库
`https://github.com/g17665032182/clothesShoppingGuide.git`，由 Render
运行 API Web Service 和 Web Static Site，数据库使用外部 Neon PostgreSQL。

## 固定配置

仓库根目录的 [`render.yaml`](../../render.yaml) 是部署配置的唯一维护入口：

| 服务                         | Render 类型      | 构建                                                                                | 启动/发布                |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------- | ------------------------ |
| `clothes-shopping-guide-api` | Node Web Service | 安装依赖、构建 API、执行 `deploy:prepare:built`                                     | 启动 `pnpm start:prod`   |
| `clothes-shopping-guide-web` | Static Site      | `pnpm install --frozen-lockfile && pnpm --filter @clothes-shopping-guide/web build` | 发布目录 `apps/web/dist` |

API 健康检查固定为 `/api/health`。Web 配置了 `/* -> /index.html` 回退，以支持
Vue Router 的 history 路由。

两个服务都从仓库根目录构建，不设置 `rootDir`。这样 Render 可以读取根目录
`pnpm-workspace.yaml`、`package.json` 和 `pnpm-lock.yaml`。

## Neon 配置

应用的 MikroORM 配置读取 `DB_*`，不是 Neon 控制台复制出来的 `PG*` 变量。将
Neon 连接信息按下表填写到 API 服务：

| 应用变量      | Neon 变量                      |
| ------------- | ------------------------------ |
| `DB_HOST`     | `PGHOST`                       |
| `DB_PORT`     | `5432`（通常与 `PGPORT` 相同） |
| `DB_USER`     | `PGUSER`                       |
| `DB_PASSWORD` | `PGPASSWORD`                   |
| `DB_NAME`     | `PGDATABASE`                   |

`PGSSLMODE=require` 和 `PGCHANNELBINDING=require` 可保留在 Render 环境中，便于
CLI 或诊断工具使用。API 的 MikroORM 配置默认启用 PostgreSQL TLS；只有隔离的本地
或 CI PostgreSQL 可显式设置 `DB_SSL=false`，Render/Neon 环境不得关闭 TLS。

不要把 Neon 连接串、密码或其他密钥写入 `render.yaml`、README、Issue 或 Git
提交。Blueprint 中的 `sync: false` 变量需要在 Render Dashboard 首次创建服务时
填写。

## 首次创建

1. 在 Render 新建 Blueprint，选择 GitHub 仓库
   `g17665032182/clothesShoppingGuide` 和 `main` 分支。
2. Render 读取仓库根目录的 `render.yaml`，确认会创建 API 和 Web 两个服务。
3. 为 API 服务填写所有 `sync: false` 变量。至少包括：
   `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`、`JWT_SECRET`、
   `PRODUCT_QUERY_CURSOR_SECRET`、`LLM_API_KEY`、`LLM_BASE_URL`、
   `LLM_MODEL` 和 `SEED_ADMIN_*`。
4. 如果启用七牛试穿，再填写 `QINIU_*`，并按业务契约补齐试穿供应商配置；
   默认 `TRY_ON_ENABLED=false`，不会开启真实试穿。
5. 部署完成后确认 API 健康检查通过，再打开 Web 地址。

当前部署地址：

- API：`https://clothes-shopping-guide-api.onrender.com`
- Web：`https://clothes-shopping-guide-web.onrender.com`

## 测试环境

测试环境使用仓库根目录的 [`render.test.yaml`](../../render.test.yaml)，资源名称与
生产服务不同。创建测试 Blueprint 时在 Render Dashboard 的 Branch 填
`codex/render-test-env`，Blueprint Path 填 `render.test.yaml`。测试 API/Web 只跟踪
该分支，并设置为 GitHub Actions 检查通过后自动部署；测试部署不会修改生产服务。
Render 的 GitHub App 必须保持启用，并且仅需授权此仓库；若 App 被暂停，Render
无法接收提交和 CI 状态更新，自动部署将停止。

1. 在 Neon 创建与生产项目隔离的测试项目或分支，并准备专用数据库用户。不要复制
   生产连接变量或把生产连接串用于测试。
2. 在 Render 选择 New > Blueprint，连接本仓库及 `main` 分支，Blueprint Path 填
   `render.test.yaml`，确认只创建 `clothes-shopping-guide-test-api` 和
   `clothes-shopping-guide-test-web`。
3. 为测试 API 填入 Neon 测试库的 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、
   `DB_NAME`，并设置独立的 `SEED_ADMIN_EMAIL`、`SEED_ADMIN_PASSWORD` 和
   `SEED_ADMIN_DISPLAY_NAME`。Render 会生成独立的 `JWT_SECRET` 和
   `PRODUCT_QUERY_CURSOR_SECRET`。
4. 默认测试 API 使用无效的 LLM 占位 Key，仅用于通过模块启动校验；聊天请求不会
   成功。若需测试聊天，须单独授权后为测试 API 配置专用的 `LLM_API_KEY`、
   `LLM_BASE_URL` 和 `LLM_MODEL`，不得复用生产或本地密钥。同时按供应商实际模型
   设置 `LLM_CONTEXT_WINDOW_TOKENS`（正整数）和匹配的 `LLM_TOKEN_ENCODING`。
   窗口缺失或非法时，聊天接口会在调用模型前返回 `503`；只补窗口不会使占位 Key
   生效。可在测试 API 的 Environment 页面一起设置这些变量，并用 **Save and deploy**
   重新部署现有构建。虚拟试穿保持关闭，不填写七牛或真实试穿凭据。
5. 部署完成后确认 API 健康检查通过，再验证测试 Web 的登录及目标业务流程。

API 构建命令在 API 构建成功后，对该 API 服务配置的数据库执行增量迁移和默认
管理员 Seeder。确认 Render API 环境变量仅含测试库凭据后，才可首次部署或手动
触发部署。测试库不会由此自动导入商品；仅在需要商品数据时通过受控流程导入测试
数据。测试环境的 API 和 Web 目前使用 Render 默认子域名，Web API 地址在
`render.test.yaml` 中指向 `clothes-shopping-guide-test-api.onrender.com`。

向 `codex/render-test-env` 推送后，GitHub Actions 依次执行格式/类型/构建校验、
API 自动化测试和隔离 PostgreSQL 迁移/Seeder 验证。所有检查通过后，Render 自动
部署测试 API 和 Web；API 健康检查路径为 `/api/health`。失败时 Render 不会自动部署。

## 每次发布

PR 合并到 `main` 后，GitHub Actions 会再次执行同一组检查；通过后 Render 才自动
部署生产 API 和 Web。Render 生产服务的 Auto-Deploy 设置必须为 **After CI Checks
Pass**，不能为 **On Commit**。现有生产服务不是由 Blueprint 管理的，需在两个生产
服务的 Dashboard Settings 中分别确认此选项。这样迁移只会在生产 API 的检查通过后
由其部署命令执行。为兼容 Render Free 计划（该计划不支持
`preDeployCommand`），API 的构建命令在编译成功后继续执行迁移和 Seeder。发布顺序
固定为：

```text
安装依赖 -> 构建 API -> migration:up -> seed -> 启动 API
```

Render 使用根目录 `pnpm deploy:prepare:built`：

```bash
pnpm --dir apps/api exec mikro-orm migration:up --config ./dist/mikro-orm.config.js
pnpm --dir apps/api exec mikro-orm seeder:run --config ./dist/mikro-orm.config.js
```

`migration:up` 只应用尚未执行的增量迁移；`seed` 使用幂等的默认
`DatabaseSeeder` 初始化管理员，不覆盖已经存在的管理员账号。迁移失败时不会继续
执行 Seeder。

生产 Neon 数据库严禁执行以下命令：

```bash
pnpm migration:fresh
```

它会删除并重建数据库，只能用于明确可销毁的本地或 CI 数据库。

GitHub 仓库 `main` 分支需将 `CI / check` 设为必需状态检查，避免未通过 CI 的 PR
合并。Render 的 **After CI Checks Pass** 是部署门控，GitHub 分支保护则是合并门控；
二者都需开启。Render 将 GitHub Actions 的 `success`、`neutral` 和 `skipped` 结论
视为检查通过，因此必需的 `check` Job 保持无条件运行，不要以 job-level `if` 跳过。

## 手工执行迁移或 Seeder

优先使用 Render 的 API Shell，并确认当前 Shell 属于 API 服务。手工脚本会先构建
API，再执行增量迁移和 Seeder：

```bash
pnpm deploy:prepare
```

如果只需要其中一步：

```bash
pnpm --filter @clothes-shopping-guide/api migration:up
pnpm --filter @clothes-shopping-guide/api seed
```

不要在本地把生产 Neon 密码写进 `.env` 后执行 destructive 命令。执行迁移前先
审查对应 Migration 的 SQL 和回滚影响；执行后查看部署日志，确认迁移完成、Seeder
成功且 API 能正常启动。

## 验证与故障处理

部署后至少检查：

```bash
curl -fsS https://clothes-shopping-guide-api.onrender.com/api/health
curl -I https://clothes-shopping-guide-web.onrender.com/
```

健康检查失败时按顺序检查：

1. Render API 日志中的启动错误和 `PRODUCT_QUERY_CURSOR_SECRET` 长度。
2. `DB_*` 是否映射到了同一个 Neon 项目，密码是否已轮换后同步更新。
3. 迁移是否完成；不要用 `migration:fresh` 试探修复。
4. Web 的 `VITE_API_BASE_URL` 是否带 `/api`，且指向当前 API 服务。
5. LLM 或七牛配置是否只影响对应功能，而不是误报为数据库故障。

需要回滚时，先在 Render 回滚到上一个已验证的部署版本，再核对数据库迁移是否
向前兼容。不要直接回滚应用代码后删除生产迁移记录。

## 资源与凭据安全

Render 免费实例可能在空闲时休眠，首次请求会有冷启动延迟。生产密钥只存储在
Render Dashboard 的环境变量中；本地 `.env`、`.env.dev` 必须保持在 Git 忽略列表
内。

此前曾在聊天内容中发送过 Neon 密码和第三方 API 凭据。它们已经视为泄露，部署
固定后应立即轮换 Neon 密码、LLM Key、七牛密钥及试穿供应商 Key，并在 Render
Dashboard 更新新值。
