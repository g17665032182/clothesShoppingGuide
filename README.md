# clothesShoppingGuide

服装购物助手，支持对话选购、商品试穿、地址管理、订单处理和管理员运营。项目使用 pnpm Workspace 管理 Vue 前端、NestJS API 与共享包。

## 核心能力

| 能力       | 当前实现与边界                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 账号与认证 | 注册、登录、JWT、HttpOnly Refresh Token、资料修改及管理员用户管理；开发环境关闭登录验证码，测试和生产环境启用 |
| 对话导购   | LangGraph 模型工具调用、商品查询、流式回复、历史会话和内部调用追踪；公开消息与内部 trace 分开管理             |
| 偏好与记忆 | 结构化穿衣偏好与独立 Markdown 长期记忆，支持用户查看、编辑及后台提取任务                                      |
| 用户信息   | 模型可查询本人地址、订单和已保存图片的安全摘要；地址详情仅在前端临时读取                                      |
| 收货地址   | 本人地址增删改查及默认地址；购买时由用户在地址卡显式选择，再由服务端写入草稿                                  |
| 聊天购买   | 从商品卡创建草稿、选择规格和地址，用户确认后创建本站订单；新地址可显式保存到地址簿                            |
| 本人订单   | 列表、筛选、详情、模拟支付、取消未过期待付款订单及确认收货；模拟支付不产生真实扣款                            |
| 聊天取消   | 明确取消意图后查询本人可取消订单并展示卡片；用户选择并确认后提交，模型没有取消写工具                          |
| 虚拟试穿   | 合格商品卡入口、照片上传、异步生成、结果查看/下载及删除；开发支持本地私有存储，真实人像流程保持关闭           |
| 管理员运营 | 用户管理、商品/SKU/库存查询、商品试穿开关和缺图上传、订单查询及整单发货                                       |

对话工具的当前实现、可扩展能力及用户确认边界见[对话工具能力清单](./docs/llm/chat-tool-capability-inventory.md)。

已付款取消、真实支付/退款及退换货尚不支持。管理员商品页支持试穿配置，不提供通用商品编辑、上下架、库存调整或订单改价。

## 环境与目录

- Node.js 22 或以上，开发基线见 [`.node-version`](./.node-version)。
- pnpm 12.14.0，与根 `package.json` 的 `packageManager` 一致。
- PostgreSQL 17；本地可通过 Docker Compose 启动。

```text
apps/
  web/                 Vue 3、Vite、TypeScript、Tailwind CSS 4、shadcn-vue
  api/                 NestJS 12、MikroORM 7、PostgreSQL、LangGraph
packages/
  shared/              共享包骨架
  typescript-config/   共享 TypeScript 配置
docs/
  contracts/           API、字段、权限和迁移契约
  development/         按领域读取的前端、后端、安全和验证约定
  testing/             全量验证计划、执行及修复记录
  <业务模块>/          设计、技术和实施文档
AGENTS.md              开发与验证约定
```

## 开发协作

较大功能采用 Agent Team 协作：主代理负责需求边界、拆分、集成和最终验证；团队代理按模块或文件承担相互独立的设计、实现或审查任务。小型或强耦合改动可由主代理直接完成。派发任务时明确文件所有权与验收标准；共享数据库、端口和构建目录等资源应隔离或串行使用。主代理审阅并验证集成结果后，才能报告整体完成。具体开发约定见 [`AGENTS.md`](./AGENTS.md)。

## 本地启动

安装依赖并创建后端配置；已有配置时保留原文件：

```bash
pnpm install --frozen-lockfile
cp -n apps/api/.env.example apps/api/.env
```

在 `apps/api/.env` 中设置：

- `NODE_ENV=development`。
- `DB_*`：示例值与项目 Docker Compose 一致，默认数据库为 `clothes_guide`。
- `JWT_SECRET`：替换为随机长密钥；本地私有下载要求至少 32 字符。
- `PRODUCT_QUERY_CURSOR_SECRET`：至少 32 字符的随机密钥，未设置时 API 无法启动。
- `SEED_ADMIN_*`：按需设置本地管理员账号；示例默认值仅供开发。

API、迁移 CLI 和 Seeder 共用配置加载器：**进程环境变量 > `apps/api/.env.dev` > `apps/api/.env`**。如果已有 `.env.dev`，其同名配置会覆盖 `.env`；修改配置后重启 API。真实密钥仅放在被 Git 忽略的服务端配置中。

启动数据库、应用增量迁移并初始化管理员：

```bash
pnpm dev:db
pnpm --filter @clothes-shopping-guide/api migration:up
pnpm seed
pnpm dev
```

`pnpm dev:db` 只启动数据库；`pnpm dev` 同时启动 Web 和 API。日常开发无需重复迁移或 Seed，数据库停止后先运行 `pnpm dev:db` 即可。

| 服务     | 地址                               |
| -------- | ---------------------------------- |
| Web      | `http://localhost:5173`            |
| API      | `http://localhost:3000/api`        |
| 健康检查 | `http://localhost:3000/api/health` |
| Swagger  | `http://localhost:3000/api/docs`   |

Web 开发服务器将 `/api` 代理到本机 3000 端口。前端路由使用 history 模式，部署时需为页面路由配置回退入口。

`pnpm migration:fresh` 内置 `--drop-db --seed`，会删除并重建目标数据库。只在明确可销毁的本地或 CI 数据库中使用；保留数据的环境使用增量迁移并先审查、备份。

### 初始化测试商品

默认 `DatabaseSeeder` 只创建管理员，不创建商品。需要测试目录时单独运行：

```bash
pnpm --filter @clothes-shopping-guide/api catalog:seed:test
```

该 Seeder 提供 20 个测试商品，覆盖上衣、下装、连衣裙、外套和鞋类，每类 4 个，包含多颜色、尺码、价格和无库存场景。重复执行会更新对应测试商品与 SKU，可能改变测试商品库存，仅用于开发或隔离测试库；库存低于当前预占量时会拒绝更新。

Seeder 不会自动开启试穿或填充本地私有图片。商品导入使用 `catalog:import`，具体输入及运行方式见[商品目录技术文档](./docs/product-guide/product-catalog-technical.md)。

## 配置与业务入口

### 模型与聊天

在后端配置 `LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`，其余超时及上下文预算见 [`apps/api/.env.example`](./apps/api/.env.example)。登录后访问 `/chat` 使用导购、购买与订单查询功能；未配置模型时不能完成真实对话生成。

`get_my_information` 由服务端绑定当前用户，不接受模型提供的 `userId`；地址和订单只返回安全摘要，图片只返回已保存元数据。购买草稿缺少收件信息时会查询本人地址簿：有地址则展示选择卡，由用户显式选择；地址簿为空时才展示动态表单收集草稿缺少的字段。地址查询失败不会按空列表处理，用户明确选择手动填写后才可改用动态表单。完整地址由前端临时读取，不发送给模型。

用户需要处理当前购买草稿时，助手可请求打开本人当前可编辑草稿的“本次购买”弹框；前端重新读取最新草稿。该请求不创建或修改草稿，正式购买操作仍由用户确认。

模型只能准备/修改草稿和执行允许的查询，不能替用户选择地址或提交动态表单。正式下单、支付、取消及收货均由用户显式操作；新地址仅在点击保存后加入地址簿。用户主动发送的聊天原文仍按聊天历史规则保存，不应将工具脱敏理解为聊天原文不保存。

### 账号与管理员

| 页面           | 路由                 |
| -------------- | -------------------- |
| 个人资料       | `/account/profile`   |
| 收货地址       | `/account/addresses` |
| 我的订单       | `/account/orders`    |
| 偏好与长期记忆 | `/account/memories`  |
| 我的试穿       | `/account/try-ons`   |
| 商品管理       | `/admin/products`    |
| 订单履约       | `/admin/orders`      |
| 用户管理       | `/admin/users`       |

管理员页面与接口均受启用账号及角色权限保护。JWT 鉴权每次请求重新读取账号状态，禁用账号后旧 Token 失效。默认管理员由 `SEED_ADMIN_*` 控制，`pnpm seed` 不覆盖已存在账号。

购买草稿在最后有效修改后 24 小时失效，订单支付期为 30 分钟。取消仅支持本人未过期的 `pending_payment` 订单：聊天卡片查询后，点击取消并在弹框确认才提交，服务端再次校验资格。网络结果未知时先读取服务端状态，避免重复下单或误报成功。

### 开发环境试穿

试穿默认关闭。开发环境没有七牛配置时，可在后端使用本地私有存储：

```dotenv
NODE_ENV=development
TRY_ON_STORAGE_DRIVER=local
TRY_ON_LOCAL_STORAGE_PATH=./.local-private/try-on
TRY_ON_LOCAL_PUBLIC_URL=http://localhost:3000
TRY_ON_ENABLED=true
TRY_ON_REAL_PHOTOS_ENABLED=false
TRY_ON_ALLOWED_TEST_IMAGE_SHA256=a545ae39c389e305725b53b766ef75d9a6b2e3d168c16f74d64511d60d4b5c55
```

以上配置仍需有效的 `JWT_SECRET`；真实生成还需独立配置 `TRY_ON_BASE_URL`、`TRY_ON_API_KEY` 和 `TRY_ON_MODEL`。本地存储仅限 `development`，文件位于 API 私有目录，不挂载静态路由。使用七牛时设置 `TRY_ON_STORAGE_DRIVER=qiniu` 并补齐 `QINIU_*` 私有空间及有效 HTTPS 域名配置，不关闭 TLS 校验。

管理员在商品详情弹框配置“支持试穿”。仅有效的上衣、下装、连衣裙、外套且有有效颜色 SKU 和可用图片时允许开启；无库存不影响资格，鞋类不支持。无可用 SKU 图或商品级图时先上传商品试穿图。商品卡仅显示当前支持的入口，创建任务时服务端再次校验。

照片上传使用[公开测试图片](./docs/virtual-try-on/fixtures/public-model.webp)原文件，来源、许可与规范化摘要见[素材说明](./docs/virtual-try-on/fixtures/README.md)。支持 JPEG、PNG、WebP，默认最大 10 MiB、最长边 4096，拒绝动画并清理 EXIF。不要重新压缩测试文件，否则可能无法命中摘要白名单。

旧测试数据已有商品图片对象键但缺少本地文件时，可运行以下恢复脚本：

```bash
pnpm --filter @clothes-shopping-guide/api catalog:hydrate-local-try-on-images
```

该脚本仅限开发环境的 `local` 模式，读取 `test-guide-*` 商品已有图片键，从白名单图片源恢复缺失文件，不为无图片键商品创建配置，也不自动开启试穿；它需要外部图片网络。

真实人像供应商的留存、处理地区及删除保障尚未完成确认，真实照片流程保持关闭。上传或本地存储验证通过不代表真实模型生成已验证。

## 常用命令与验证

| 命令                                                          | 用途                                 |
| ------------------------------------------------------------- | ------------------------------------ |
| `pnpm dev:db` / `pnpm dev`                                    | 启动数据库 / 前后端开发服务          |
| `pnpm --filter @clothes-shopping-guide/api migration:up`      | 增量升级数据库                       |
| `pnpm seed`                                                   | 初始化管理员                         |
| `pnpm --filter @clothes-shopping-guide/api catalog:seed:test` | 写入或更新测试商品                   |
| `pnpm seeder:create <类名>`                                   | 创建 Seeder                          |
| `pnpm --filter @clothes-shopping-guide/api test`              | API 自动化测试，数据库用例受环境门控 |
| `pnpm check`                                                  | 仓库格式检查、递归类型检查和构建     |
| `pnpm format`                                                 | 格式化全仓，执行前检查已有修改       |

`pnpm check` **不包含 API 测试**，两者需分别运行。当前 Web 包没有单元/组件或浏览器测试脚本；类型检查和构建不能替代交互验收。当前 CI 运行 `pnpm check`，并在临时 PostgreSQL 服务中执行 `migration:fresh`，不代表已执行全部业务测试。

全量验证的并行/串行安排、各 `RUN_*` 门控及库名变量见[验证计划与执行记录](./docs/testing/project-full-validation-plan.md)。数据库测试只连接具名可销毁库，运行前核对初始化与清理逻辑；同库迁移和集成测试串行执行。跳过不能计为通过。

2026-11-11 修复复测记录：API 共 280 项，265 通过、15 项数据库门控跳过、0 失败；`pnpm check` 通过。首轮失败的迁移回滚、迁移集合断言及两个聊天集成夹具均已修复并在隔离 PostgreSQL 库复测通过。已认证浏览器全流程、移动端键盘/视觉验收及真实 LLM/试穿供应商调用仍未完成；详见记录中的“修复复测”。

## 开发与文档

开发规范入口见 [`AGENTS.md`](./AGENTS.md)，其中按任务链接前端、后端、安全和验证专题约定。新增应用位于 `apps/`，共享包位于 `packages/`，内部依赖使用 `workspace:*` 和 `@clothes-shopping-guide/` 命名空间。

| 文档           | 入口                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API 与资源契约 | [契约索引](./docs/contracts/README.md)                                                                                                                                                                                                          |
| 商品目录       | [技术方案](./docs/product-guide/product-catalog-technical.md)                                                                                                                                                                                   |
| LLM 与上下文   | [模型模块](./docs/llm/llm-module-technical.md)、[系统上下文](./docs/llm/system-context-technical.md)                                                                                                                                            |
| 偏好与记忆     | [分离方案](./docs/user-memory/user-preference-memory-separation-technical.md)                                                                                                                                                                   |
| 地址簿与工具   | [实施记录](./docs/user-addresses/user-addresses-implementation.md)                                                                                                                                                                              |
| 聊天用户信息   | [设计、技术与实施](./docs/chat-user-information/chat-user-information-design.md)、[技术文档](./docs/chat-user-information/chat-user-information-technical.md)、[实施记录](./docs/chat-user-information/chat-user-information-implementation.md) |
| 动态表单       | [设计、技术与实施](./docs/chat-dynamic-form/chat-dynamic-form-design.md)、[技术文档](./docs/chat-dynamic-form/chat-dynamic-form-technical.md)、[实施记录](./docs/chat-dynamic-form/chat-dynamic-form-implementation.md)                         |
| 订单与聊天购买 | [订单](./docs/orders/order-module-implementation.md)、[购买](./docs/chat-purchase/chat-purchase-implementation.md)                                                                                                                              |
| 聊天取消订单   | [实施记录](./docs/chat-order-cancellation/chat-order-cancellation-implementation.md)                                                                                                                                                            |
| 虚拟试穿       | [技术方案](./docs/virtual-try-on/virtual-try-on-technical.md)、[商品配置](./docs/virtual-try-on/product-try-on-setting-technical.md)                                                                                                            |
| 全量验证       | [测试索引](./docs/testing/README.md)、[计划、执行与修复复测](./docs/testing/project-full-validation-plan.md)                                                                                                                                    |
| 进度完善计划   | [文档、数据库、浏览器及供应商后续工作](./docs/testing/project-progress-improvement-plan.md)                                                                                                                                                     |

各模块实施文档保留当时的验证结果与缺口；后续跨模块复测以全量验证记录对应日期的结果为准。
