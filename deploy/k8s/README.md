# Kubernetes 部署资源

这些清单包含基础模板以及测试、生产两个环境 overlay。测试 overlay 使用
`clothes-guide-staging`，生产 overlay 使用 `clothes-guide-production`。两个 Namespace
需由集群管理员预先创建；Secret、Gateway、TLS 和云数据库仍由环境管理员或受控
密钥系统管理，不写入仓库。

## 构建镜像

在仓库根目录执行：

```bash
docker build --target runtime -f deploy/docker/api.Dockerfile -t clothes-guide-api:<git-sha> .
docker build --target migration -f deploy/docker/api.Dockerfile -t clothes-guide-api-migration:<git-sha> .
docker build -f deploy/docker/web.Dockerfile -t clothes-guide-web:<git-sha> .
```

API 迁移镜像保留 MikroORM CLI，供一次性 Job 使用；不要让 API Pod 启动命令执行迁移。
发布时应把镜像推送到受控仓库，并在 Kustomize overlay 中使用 Git SHA、镜像摘要或
本次流水线唯一标签，避免 `latest` 漂移。

## API Secret

`clothes-guide-api-env` 至少应包含当前环境所需的 `DB_HOST`、`DB_PORT`、`DB_USER`、
`DB_PASSWORD`、`DB_NAME`、`JWT_SECRET`、`PRODUCT_QUERY_CURSOR_SECRET`、LLM 配置、
管理员初始化配置，以及：

- `CAPTCHA_STORAGE=redis`（Deployment 已显式设置，Secret 不应覆盖它）
- `CAPTCHA_REDIS_URL`
- `CAPTCHA_HMAC_SECRET`（所有 API 副本使用同一值，且达到应用要求的最小长度）

生产和测试必须使用不同的数据库、Redis 和密钥。不要把 Secret 内容写入 YAML 或 Git。
`ghcr-pull` 应为能读取 GHCR 的 `kubernetes.io/dockerconfigjson` Secret；如果镜像仓库
明确设为公开，可按平台策略移除 `imagePullSecrets`，但生产建议仍保留私有镜像。

## 测试与生产 Overlay

```bash
# 查看测试环境最终清单
kubectl kustomize deploy/k8s/staging

# 查看生产环境最终清单
kubectl kustomize deploy/k8s/production
```

当前没有自动 Kubernetes/GHCR 发布 workflow。测试和生产继续由 Render Blueprint 发布；
这些 overlay 仅用于后续明确迁移到外部 Kubernetes 时的手动验收。

启用前，在两个命名空间分别创建 `clothes-guide-api-env` 和 `ghcr-pull`。两个环境
必须使用不同的数据库、Redis、JWT/游标签名密钥、验证码 HMAC 密钥和第三方凭据。

## 部署顺序

```bash
# 由集群管理员预先执行一次；CI 使用的 kubeconfig 不需要集群级权限。
kubectl create namespace clothes-guide-staging
kubectl create namespace clothes-guide-production

# 首次部署测试环境
kubectl create -n clothes-guide-staging -f deploy/k8s/migration-job.yaml
kubectl wait --for=condition=complete --timeout=10m -l app.kubernetes.io/name=clothes-guide-migration job
kubectl apply -k deploy/k8s/staging
kubectl rollout status -n clothes-guide-staging deployment/clothes-guide-api --timeout=10m
kubectl rollout status -n clothes-guide-staging deployment/clothes-guide-web --timeout=10m
kubectl port-forward -n clothes-guide-staging service/clothes-guide-api 3000:80
curl -fsS http://127.0.0.1:3000/api/health
```

迁移成功后才允许切换 API Deployment；如果迁移失败，停止发布并保留日志。该 Job
只运行增量迁移，不运行 `migration:fresh`，也不承担生产数据回滚。

## HTTPRoute 与 SSE

`examples/httproute.yaml` 仅为按需启用的示例。`/api` 路径原样转发到 API，不能在
网关上去掉全局前缀。实际 Gateway 实现必须关闭或延长 SSE 响应缓冲和空闲超时；需要
根据所选 Gateway Controller 补充对应注解或策略，并用聊天流真实请求验收。当前尚无
已确认的测试/生产域名、Gateway 名称和 TLS 配置，因此环境 overlay 暂不创建
HTTPRoute；切换到 Kubernetes 前须补齐并验收这些入口配置。

## 本地 kind

本机 Docker Desktop 的 `kind-clothes-guide-dev` 集群使用
[`local/`](./local/) overlay。它包含临时 PostgreSQL、Redis、API/Web 镜像和本地
Nginx `/api` 代理，不连接 Render、Neon 或 GHCR。完整的 Secret、镜像导入、迁移、
Seeder 和端口转发命令见 [`local/README.md`](./local/README.md)。
