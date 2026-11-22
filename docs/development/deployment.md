# Render、Neon 与 Redis 部署

[返回开发文档索引](./README.md) · [返回项目文档总览](../README.md)

核对日期：2026-11-23。仓库 Blueprint 的目标配置使用 GitHub 仓库
`https://github.com/g17665032182/clothesShoppingGuide.git`，由 Render
运行 API/Web Docker Web Service 和生产 Key Value，数据库使用外部 Neon
PostgreSQL。现有 Render 服务仍需按“现有 Render 服务切换”完成 Dashboard 同步和
Web 入口切换；本手册描述目标配置，不代表线上服务已完成切换。Kubernetes 清单仍用于
本地 kind 和后续可选迁移方案。

## 固定配置

仓库根目录的 [`render.yaml`](../../render.yaml) 是部署配置的唯一维护入口：

| 服务                                | Render 类型        | Dockerfile                     | 启动/发布                                         |
| ----------------------------------- | ------------------ | ------------------------------ | ------------------------------------------------- |
| `clothes-shopping-guide-api`        | Docker Web Service | `deploy/docker/api.Dockerfile` | 启动时执行增量迁移和管理员 Seeder，然后启动 API   |
| `clothes-shopping-guide-web-docker` | Docker Web Service | `deploy/docker/web.Dockerfile` | Nginx 提供 Vue 构建产物；API 地址在镜像构建时写入 |
| `clothes-shopping-guide-redis`      | Key Value          | Render 托管 Redis 兼容服务     | 仅允许私网连接                                    |

API 健康检查固定为 `/api/health`。Web Nginx 配置了 `try_files` 回退到
`/index.html`，以支持 Vue Router 的 history 路由。

API 和 Web 都使用仓库根目录作为 Docker build context，Render 按 Blueprint 中的
Dockerfile 路径构建镜像。Render 环境变量 `VITE_API_BASE_URL` 作为 Docker build
argument 提供给 Vite；Web 镜像中的 Nginx 监听 `8080`，API 监听 `3000`。

API 镜像入口脚本在每次容器启动时执行：

```text
增量 migration:up -> 默认管理员 Seeder ->（测试环境）测试商品 Seeder -> 启动 API
```

增量迁移和默认管理员 Seeder 可重复执行。测试环境设置
`RUN_TEST_CATALOG_SEEDER=true`，因此测试商品 Seeder 会在**每次测试 API 启动**时
运行并更新对应商品和 SKU，可能重置测试 SKU 库存；若种子库存低于当前预占量，Seeder
会失败并阻止 API 启动。生产环境不设置该变量，不导入测试商品。该流程不使用
`preDeployCommand`；服务发布和容器重启都会运行 API 启动脚本。
Docker API 将应用日志写入标准输出，由 Render 收集；本地私有试穿目录和日志目录
不会打进镜像。
每个 API 副本启动时都会运行迁移和 Seeder；扩容到多个副本前，应先验证并发启动时的
迁移和初始化行为。

## 现有 Render 服务切换

更新仓库 Blueprint 不会自动完成现有服务的运行时切换。部署前应在 Render Dashboard
核对服务来源、分支、Blueprint 管理状态和域名：

- API Web Service 可将 runtime 改为 Docker，并使用 `deploy/docker/api.Dockerfile`。
- Render Static Site 不能原地改成 Docker Web Service；Blueprint 使用新的
  `*-web-docker` 服务名创建 Docker Web Service，用对应环境的分支和
  `deploy/docker/web.Dockerfile` 构建。验证 `/`、Vue 深链接和 API 请求后，再切换
  自定义域名或完成服务替换。
- 切换期间保留旧 Web Static Site，直到新 Docker Web Service 验收通过。若站点只用
  Render 默认域名，替换服务时先确认新的服务名和访问地址，并相应更新对外入口。

生产服务此前不是由 Blueprint 管理的。首次将这两份 Blueprint 同步到已有环境时，
逐项核对 Render 的变更预览；不要假设 Blueprint 同步会自动接管或替换所有既有服务。

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

## Redis 与验证码

生产和测试各自使用一个 Render Key Value，`ipAllowList: []` 只允许 Render 私网
连接；两套服务不共享数据、连接串或 HMAC 密钥。API 的 Blueprint 自动设置：

```text
CAPTCHA_STORAGE=redis
CAPTCHA_REDIS_URL=<对应环境 Key Value 的私网 connectionString>
CAPTCHA_HMAC_SECRET=<Render 为该环境生成的独立密钥>
```

不要把 `CAPTCHA_REDIS_URL` 或 `CAPTCHA_HMAC_SECRET` 写进仓库。Render Key Value
必须与 API 位于同一 region，避免应用通过公网访问验证码存储。

## 首次创建

1. 在 Render 新建 Blueprint，选择 GitHub 仓库
   `g17665032182/clothesShoppingGuide` 和 `main` 分支。
2. Render 读取仓库根目录的 `render.yaml`，确认会创建 API、Web 和生产 Key Value
   三个服务。
3. 为 API 服务填写所有 `sync: false` 变量。至少包括：
   `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`、`JWT_SECRET`、
   `PRODUCT_QUERY_CURSOR_SECRET`、`LLM_API_KEY`、`LLM_BASE_URL`、
   `LLM_MODEL` 和 `SEED_ADMIN_*`。需要聊天天气查询时，在 Render Dashboard
   将 `LLM_ENABLE_REMOTE_TOOLS` 设为 `true`，并在 Render Secret 配置
   `AMAP_MAPS_API_KEY`。Key 不得提交到仓库；没有有效 Key 时天气工具保持关闭。
   `CAPTCHA_STORAGE`、`CAPTCHA_REDIS_URL` 和
   `CAPTCHA_HMAC_SECRET` 由 Blueprint 自动配置，不要手动改成内存模式。
4. 如果启用七牛试穿，再填写 `QINIU_*`，并按业务契约补齐试穿供应商配置；
   默认 `TRY_ON_ENABLED=false`，不会开启真实试穿。
5. 部署完成后确认 API 健康检查通过，再打开 Web 地址。

当前部署地址：

- API：`https://clothes-shopping-guide-api.onrender.com`
- 现有 Static Site：`https://clothes-shopping-guide-web.onrender.com`
- Docker Web 验收服务：`https://clothes-shopping-guide-web-docker.onrender.com`

## 测试环境

测试环境使用仓库根目录的 [`render.test.yaml`](../../render.test.yaml)，资源名称与
生产服务不同。创建测试 Blueprint 时在 Render Dashboard 的 Branch 填
`codex/render-test-env`，Blueprint Path 填 `render.test.yaml`。测试 API/Web 只跟踪
该分支，并设置为 GitHub Actions 检查通过后自动部署；测试部署不会修改生产服务。
Render 的 GitHub App 必须保持启用，并且仅需授权此仓库；若 App 被暂停，Render
无法接收提交和 CI 状态更新，自动部署将停止。

1. 在 Neon 创建与生产项目隔离的测试项目或分支，并准备专用数据库用户。不要复制
   生产连接变量或把生产连接串用于测试。
2. 在 Render 选择 New > Blueprint，连接本仓库及 `codex/render-test-env` 分支，
   Blueprint Path 填 `render.test.yaml`，确认创建测试 API、Docker 测试 Web 和
   `clothes-shopping-guide-test-redis`。
3. 为测试 API 填入 Neon 测试库的 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、
   `DB_NAME`，并设置独立的 `SEED_ADMIN_EMAIL`、`SEED_ADMIN_PASSWORD` 和
   `SEED_ADMIN_DISPLAY_NAME`。Render 会生成独立的 `JWT_SECRET` 和
   `PRODUCT_QUERY_CURSOR_SECRET`、`CAPTCHA_HMAC_SECRET`；Blueprint 会把测试
   Key Value 的私网连接串写入 `CAPTCHA_REDIS_URL`。
4. 默认测试 API 使用无效的 LLM 占位 Key，仅用于通过模块启动校验；聊天请求不会
   成功。若需测试聊天，须单独授权后为测试 API 配置专用的 `LLM_API_KEY`、
   `LLM_BASE_URL` 和 `LLM_MODEL`，不得复用生产或本地密钥。同时按供应商实际模型
   设置 `LLM_CONTEXT_WINDOW_TOKENS`（正整数）和匹配的 `LLM_TOKEN_ENCODING`。
   窗口缺失或非法时，聊天接口会在调用模型前返回 `503`；只补窗口不会使占位 Key
   生效。可在测试 API 的 Environment 页面一起设置这些变量，并用 **Save and deploy**
   重新部署现有构建。虚拟试穿保持关闭，不填写七牛或真实试穿凭据。
5. 部署完成后确认 API 健康检查通过，再验证测试 Web 的登录及目标业务流程。

测试 API 启动时，入口脚本先执行增量迁移和管理员初始化，再导入测试商品。任一步骤
失败都会使容器启动失败，API 健康检查无法通过。确认 Render API 环境变量仅含测试库
凭据后，才可首次部署或手动触发部署。每次测试 API 容器重启都会更新对应测试商品与
SKU，包括库存；当种子库存低于当前预占量时，Seeder 会拒绝写入并阻止 API 启动。
Web API 地址在 `render.test.yaml` 中指向
`clothes-shopping-guide-test-api.onrender.com`，并在 Web Docker 镜像构建时写入。
新 Docker 测试 Web 服务名为 `clothes-shopping-guide-test-web-docker`；旧 Static Site
保留到新服务完成验收。

向 `codex/render-test-env` 推送后，GitHub Actions 依次执行格式/类型/构建校验、
API 自动化测试，并在隔离 PostgreSQL 中验证迁移、管理员和测试商品 Seeder。所有
检查通过后，Render 自动构建并部署测试 API/Web Docker 镜像；API 健康检查路径为
`/api/health`。
检查失败时 Render 不会自动部署。

## 每次发布

### Web 版本号与发布

Web 使用语义化版本 `MAJOR.MINOR.PATCH`，唯一版本来源是
[`apps/web/package.json`](../../apps/web/package.json) 的 `version` 字段；Vite 构建时
将其写入前端，顶栏负责添加 `v` 前缀。根目录和 API 的包版本不随 Web 版本变更。
`0.0.0` 是占位值，Web 正式版本从 `0.1.0` 开始。

进入 `1.0.0` 前属于初始开发阶段，版本保持 `0.MINOR.PATCH`：修复问题递增
`PATCH`，新增功能递增 `MINOR`；此阶段若有不兼容变化，也递增 `MINOR`，并在 PR
中明确标记影响。达到 `1.0.0` 并承诺稳定兼容后，按常规规则递增：不兼容变更递增
`MAJOR`，向后兼容的新功能递增 `MINOR`，缺陷修复、安全修复和不改变行为的调整递增
`PATCH`。每次只按最高影响级别递增一次；不要为普通开发提交逐次改号。

发布步骤：

1. 准备发布 PR 时，根据上述规则更新 Web 包的 `version`，并在 PR 描述列出版本号和
   变更摘要；该版本随候选提交部署到测试环境并完成业务验收。
2. 验收通过后合并到 `main`。Render 在 CI 通过后自动部署生产 API 和 Web；生产
   Web 部署完成后确认顶栏显示的版本与 `apps/web/package.json` 一致。
3. 确认生产部署成功后，在对应生产部署提交上创建 `web-vX.Y.Z` Git 标签，例如
   `web-v0.1.0`。标签只标记已发布版本，不触发或替代 Render 部署。
4. 已发布版本不可复用。若发布后发现问题，修复并递增 `PATCH`，再按完整流程验收和
   发布；回滚部署到旧版本时也保留原版本号及其标签。

PR 合并到 `main` 后，GitHub Actions 会运行格式/类型/构建校验、API 自动化测试、
隔离 PostgreSQL 迁移和管理员 Seeder 验证。检查通过后，Render 自动构建并部署生产
API/Web Docker 镜像。Render 生产服务的 Auto-Deploy 设置必须为
**After CI Checks Pass**，不能为 **On Commit**。生产 API 容器启动时执行增量迁移和
幂等管理员 Seeder；迁移或 Seeder 失败时 API 不会通过健康检查。发布顺序为：

```text
GitHub CI 通过 -> Render 构建 API/Web 镜像 -> API 容器启动时 migration:up -> seed -> API 健康检查
```

API 镜像通过程序化初始化脚本运行 ORM 迁移和 Seeder，不需要在运行镜像中安装
MikroORM CLI：

```bash
node ./api-bootstrap.mjs
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

## 可选 Kubernetes 迁移（默认关闭）

Docker/Kubernetes 资源位于 [`deploy/`](../../deploy/)，当前 Render 是唯一启用的
测试/生产发布入口。自动 Kubernetes/GHCR release workflow 已移除，不需要
`KUBE_CONFIG_DATA`，也不会影响 Render 的 CI/CD。

如果未来明确迁移到外部 Kubernetes 集群，再单独设计部署身份、镜像发布、namespace
级权限、独立 Redis 和生产审批；Render 本身不是 Kubernetes 集群，也不提供
`kubectl` kubeconfig。

Render 发布顺序为：分支 CI 通过 → 测试 Blueprint 自动构建并启动 API/Web Docker
镜像（API 启动时执行迁移、Seeder 和测试商品 Seeder）→ 测试验收 → PR 合并 `main`
→ 生产 Blueprint 在 GitHub 检查通过后自动构建并启动 API/Web Docker 镜像。验证码
使用对应环境的 Key Value。

本地 Docker/kind 验证可直接使用 `kind-clothes-guide-dev` 集群和
[`deploy/k8s/local/README.md`](../../deploy/k8s/local/README.md)。本地 namespace 为
`clothes-guide-dev`，数据库使用临时 `emptyDir`，删除集群会清空数据；它不读取生产
Neon、Render 或 GHCR 凭据。

## 手工执行迁移或 Seeder

优先使用 Render 的 API Shell，并确认当前 Shell 属于 API 服务。Docker API 镜像工作
目录为 `/app`。手动运行同一套增量迁移和 Seeder 初始化流程：

```bash
node ./api-bootstrap.mjs
```

测试 API 设置了 `RUN_TEST_CATALOG_SEEDER=true`，因此该命令也会运行测试商品 Seeder；
生产环境未设置时只执行迁移和管理员 Seeder。

不要在本地把生产 Neon 密码写进 `.env` 后执行 destructive 命令。执行迁移前先
审查对应 Migration 的 SQL 和回滚影响；执行后查看部署日志，确认迁移完成、Seeder
成功且 API 能正常启动。

## 验证与故障处理

部署后至少检查：

```bash
curl -fsS https://clothes-shopping-guide-api.onrender.com/api/health
curl -I https://clothes-shopping-guide-web-docker.onrender.com/
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
