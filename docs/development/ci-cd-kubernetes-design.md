# 多人协作与 Render CI/CD 设计

[开发文档索引](./README.md) · [现行 Render 部署手册](./deployment.md) · [用户与认证契约](../contracts/user-crud-contract.md)

**状态：Render 主线已实现，Kubernetes 作为可选迁移方案保留。** 现状核对日期：2026-11-22。测试和生产继续使用 Render；Kubernetes 发布工作流默认关闭。

## 1. 目标与现状

目标是让多人并行开发，每个变更都能追踪到通过 CI、业务验收和部署的具体版本；当前以 Render 完成测试/生产发布，并用 Redis Key Value 解决 API 多副本之间的验证码共享问题。Docker 与 Kubernetes 作为本地验收和后续迁移能力保留。

| 事项       | 当前状态                                                                                           | 本设计                                                        |
| ---------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 代码托管   | GitHub 个人账号下的公开仓库                                                                        | 已确认留在当前仓库，不迁 Gitee 或组织，不依赖原生 Merge Queue |
| 合并保护   | `main` 要求 PR、`check` 通过并同步最新 `main`；必需审批人数为 0                                    | 保留现有规则，有同事可审查后增加至少 1 人审批                 |
| CI         | [现有 CI](../../.github/workflows/ci.yml) 覆盖目标为 `main` 的 PR、`main` 和测试固定分支的推送     | 复用现有检查，覆盖功能分支和启用时的测试分支                  |
| 线上部署   | [生产](../../render.yaml) 跟踪 `main`，[测试](../../render.test.yaml) 跟踪 `codex/render-test-env` | Render API/Web/Key Value 主发布；Kubernetes 后续可选          |
| 数据与认证 | PostgreSQL 使用 Neon；验证码存在 API 进程内的 `Map`                                                | Neon 不迁移；验证码由 Redis 跨副本共享                        |

首期不引入自建数据库集群、每个 PR 自动创建整套环境，也不改登录 UI、验证码类型或业务功能。是否切换生产须另行确认。

## 2. 分支、验收与合并

1. **开发**：从最新 `origin/main` 创建 `codex/feature/<功能>`。推送后跑 CI，开发中可以开 Draft PR。同一功能只维护一个面向 `main` 的 PR。
2. **验收**：默认部署功能分支上通过 CI 的确切提交。若确实需要专用测试分支，从该功能提交建立 `codex/test/<功能>`，推送后运行相同 CI，再用测试分支开唯一的发布 PR。测试分支不混入其他功能或测试环境专用配置；修复回到功能分支，之后同步到测试分支重新验收。
3. **审查与合并**：PR 记录验收过的提交 SHA、环境、用例及结论。PR 新提交或因同步 `main` 产生新 SHA 后，旧验收不适用于新版本。PR 的 `check` 校验与 `main` 的合并结果；多人协作时建议启用过期审批撤销，并给流水线、迁移和认证设置明确的审查人。已有 PR 先合入时，其他 PR 更新基线后重跑检查。
4. **区分共享与独立环境**：现有 Render 测试环境只跟踪固定分支，还不能自动部署任意功能分支。过渡期若接入按 SHA 部署，应先验证服务能部署该仓库的指定提交，并关闭共享测试服务原有的分支自动部署，避免相互覆盖。共享环境一次只允许一个部署和验收占用，记录占用者、SHA 和释放时间；涉及未合并的迁移时使用独立测试库。并行验收成为常态后，再按需创建隔离的预览环境和测试数据，关闭 PR 时清理。

首期由 PR 记录业务验收，CI 成功与业务验收通过分别记录。若后续把测试部署变成强制合并条件，先验证规则能绑定到当前 PR 提交，并避免共享环境的部署被后续 PR 覆盖。

## 3. Docker 与可选 Kubernetes 架构

```text
浏览器 ── HTTPS 入口
            ├─ /api/* ── API Service ── NestJS Pods ── Neon PostgreSQL
            │                              └──────── Redis：登录验证码
            └─ 其他路径 ─ Web Service ── Nginx Pods：Vue dist
```

- **镜像**：从 pnpm monorepo 根目录做多阶段构建，沿用仓库 Node/pnpm 版本与锁文件。API 运行 `node dist/main.js`，保留编译后迁移文件、Prompt Markdown 和必要运行依赖，并验证 Linux 镜像中的 `sharp` 可用。Web 由 Nginx 提供 Vite 构建产物，保留 Vue Router 的 `index.html` 回退。`.dockerignore` 排除真实 `.env*`、私有图片和其他非构建资产；不把凭据写进镜像层。
- **Kubernetes**：API 与 Web 各用一个 `Deployment` 和一个 `Service`。选定平台支持的 HTTPS 网关，同域转发 `/api`，不剥离 API 前缀；Web 保持默认 `/api`，同一 Web 镜像可跨环境使用。验证登录 Cookie、客户端 IP 与代理信任配置；为 SSE 验证网关不会缓冲事件，空闲超时和连接下线符合业务需求。
- **环境隔离**：`staging` 和 `production` 的工作负载、Neon 数据库、Redis 及凭据相互隔离，部署身份按环境授权。生产密钥从受控密钥存储注入，不提交到仓库，不提供给 PR 检查。托管集群、网络出口、证书及成本待确认。
- **Render 主线**：测试和生产 API 继续使用 Render Node Web Service，Web 使用 Static Site，验证码使用同 region 的私网 Key Value。当前 API 保留 Render 的构建阶段迁移/Seeder 顺序，不把数据库迁移挪到 Docker 容器启动命令。
- **健康与副本**：测试阶段可从单 API 副本开始验证镜像。现有 `/api/health` 只表示进程能响应，不代表数据库或 Redis 可用；就绪策略和冒烟验证应覆盖必要依赖，存活探针不因外部依赖短暂抖动重启整个应用。启用 API 多副本或新旧版本共存前，先验证验证码共享、限流策略、后台任务竞争、优雅下线和数据库连接数。

## 4. 验证码共享存储

沿用认证模块和 `svg-captcha`，通过存储接口接入 Redis 适配器，不改前端请求结构或返回格式。生产和部署验收环境强制使用 Redis；内存实现只供本地或不验证 Redis 的单元测试使用。

| 场景     | 行为                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 发放     | 保留随机 `challengeId`。以 `auth:captcha:v1:<challengeId>` 为键，用 `SET ... NX EX 300` 写入校验数据，写入成功后才返回图片。 |
| 存储     | 不存答案明文或图片。建议使用带独立服务端密钥的 HMAC 对规范化答案生成校验摘要，并绑定挑战 ID；各副本使用同一环境的密钥。      |
| 消费     | Redis 6.2+ 使用 `GETDEL` 原子读取并删除，再做常量时间比对。第一次提交即消费，答错也不能重试，不拆成 `GET`、`DEL`。           |
| 无效挑战 | 缺失、过期、答错和已消费继续走现有验证码错误；验证码未通过时不发令牌、不建会话。                                             |
| 服务故障 | 连接失败或超时拟返回通用 `503`，不绕过验证码、不回退到 Pod 内存。消费结果不明时不重放登录，请求方重新获取挑战。              |

Redis 只使用私网连接和受限账户，监控可用性、延迟、容量与淘汰情况，不记录提交答案或摘要。`GETDEL` 的原子性适用于 Redis 正常工作时的并发消费，不应直接视为跨异步故障切换的严格至多一次保证。若故障切换也必须保证不可重复消费，需在选型时明确验证；不能满足时评估复用 PostgreSQL 的事务删除方案。前端 60 秒倒计时保留，但不替代服务端防刷。实施前先更新[认证契约](../contracts/user-crud-contract.md)中的存储边界和登录故障行为。

## 5. CI/CD 与迁移

| 触发点                                                         | 流水线                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `codex/feature/*`、可选 `codex/test/*` 推送及发往 `main` 的 PR | 复用根 `pnpm check`、API 自动化测试、CI 临时 PostgreSQL 迁移校验；增加 Redis 集成用例。保留稳定的 `check` 名称，不给 PR 作业部署权限。 |
| `codex/render-test-env` CI 通过                                | Render 自动部署测试 API/Web；API 执行增量迁移、Seeder、测试商品 Seeder，再做业务验收。                                                 |
| 合并到 `main`                                                  | 对合并提交再跑 CI；检查通过后 Render 自动部署生产 API/Web，生产 API 使用独立 Neon 和 Key Value。                                       |

- **权限**：公开仓库的 fork PR 只运行无生产凭据的 CI。不在高权限 `pull_request_target` 作业中构建或执行 PR 代码。Render 生产部署由 GitHub `check` 和 Render `checksPass` 双重门控。
- **数据库**：Render API 部署继续执行增量 `migration:up` 和幂等 Seeder；测试商品只在隔离测试库导入，生产不执行 `migration:fresh`。Kubernetes Migration Job 仅在将来迁移时重新启用。
- **切流与回退**：当前不切换外部流量到 Kubernetes；Render 继续服务测试和生产。未来迁移前需再验证生产网络、域名、证书、数据备份和回切路径，并采用向后兼容迁移。

## 6. 实施顺序与验收

| 阶段                    | 交付与验收                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. 整理 CI 与协作       | 扩展分支触发，定义 PR 验收记录，验证 CI 失败无法合并，提交变化后重新验收。保留现有 Render 生产发布。                    |
| 2. Render 测试环境      | 使用测试 Neon、测试 Key Value 和 Render Blueprint；验证 Vue 深链接、数据库读写、登录/刷新及聊天 SSE。                   |
| 3. Redis 与多副本       | Render API 使用 Key Value；同一挑战跨实例一次性消费，答错即消费，过期不可用；Redis 超时/断开返回 `503` 且不签发会话。   |
| 4. 可选 Kubernetes 迁移 | 只有明确需要自管集群、独立网关或 Kubernetes 运维能力时，再准备外部集群和 namespace 级凭据；在此之前保持 workflow 关闭。 |

**待确认**：是否确实需要每功能测试分支；共享测试环境的审批与占用规则；Render Key Value 计划与持久化策略；是否未来迁移到自管 Kubernetes。

**本次交付**：已实现功能/测试分支 CI 触发、Render 测试/生产 Blueprint、两套私网 Key Value、Redis 验证码存储、API/Web/迁移 Docker 镜像和本地 kind 资源。Kubernetes 基础/本地清单保留；自动 Kubernetes/GHCR 发布 workflow 已移除，当前不参与线上发布。实际实施时按[环境与验证约定](./validation.md)记录通过、失败、跳过及未执行项。

## 参考

- GitHub：[保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、[合并队列](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)、[发布容器镜像](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)。
- Docker 与 Kubernetes：[多阶段构建](https://docs.docker.com/build/building/multi-stage/)、[Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)、[Job](https://kubernetes.io/docs/concepts/workloads/controllers/job/)、[Gateway API 路由](https://gateway-api.sigs.k8s.io/guides/user-guides/http-routing/)。
- Redis 与 Render：[SET](https://redis.io/docs/latest/commands/set/)、[GETDEL](https://redis.io/docs/latest/commands/getdel/)、[Render 部署与指定提交](https://render.com/docs/deploys#deploying-a-specific-commit)。
