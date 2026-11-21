# 本地 kind 环境

此 overlay 仅用于 `kind-clothes-guide-dev` 本地集群，不连接 Render、Neon、GHCR 或
生产凭据。PostgreSQL 使用 `emptyDir`，删除 Pod/namespace/集群会清空本地数据。

首次部署先创建本地 namespace：

```bash
kubectl create namespace clothes-guide-dev --dry-run=client -o yaml | kubectl apply -f -
```

首次启动前，在 `clothes-guide-dev` namespace 创建本地 Secret。值留在当前 shell 和
集群 Secret 中，不写入仓库：

```bash
namespace=clothes-guide-dev
db_password="$(openssl rand -hex 24)"
jwt_secret="$(openssl rand -hex 32)"
cursor_secret="$(openssl rand -hex 32)"
captcha_secret="$(openssl rand -hex 32)"
admin_password="$(openssl rand -hex 16)"

kubectl create secret generic clothes-guide-local-db \
  -n "$namespace" \
  --from-literal=POSTGRES_DB=clothes_guide_dev \
  --from-literal=POSTGRES_USER=clothes \
  --from-literal="POSTGRES_PASSWORD=$db_password"

kubectl create secret generic clothes-guide-api-env \
  -n "$namespace" \
  --from-literal=NODE_ENV=production \
  --from-literal=DB_USER=clothes \
  --from-literal="DB_PASSWORD=$db_password" \
  --from-literal=DB_NAME=clothes_guide_dev \
  --from-literal="JWT_SECRET=$jwt_secret" \
  --from-literal="PRODUCT_QUERY_CURSOR_SECRET=$cursor_secret" \
  --from-literal=CAPTCHA_STORAGE=redis \
  --from-literal=CAPTCHA_REDIS_URL=redis://clothes-guide-redis:6379 \
  --from-literal="CAPTCHA_HMAC_SECRET=$captcha_secret" \
  --from-literal=LLM_PROVIDER=openai-compatible \
  --from-literal=LLM_API_KEY=local-disabled \
  --from-literal=LLM_MODEL=local-disabled \
  --from-literal=TRY_ON_ENABLED=false \
  --from-literal=TRY_ON_REAL_PHOTOS_ENABLED=false \
  --from-literal=TRY_ON_STORAGE_DRIVER=qiniu \
  --from-literal=SEED_ADMIN_EMAIL=admin@clothes-guide.local \
  --from-literal="SEED_ADMIN_PASSWORD=$admin_password" \
  --from-literal=SEED_ADMIN_DISPLAY_NAME=本地管理员
```

构建/载入镜像、部署依赖、迁移和初始化管理员：

```bash
docker build --target runtime -f deploy/docker/api.Dockerfile -t clothes-guide-api:local .
docker build --target migration -f deploy/docker/api.Dockerfile -t clothes-guide-api-migration:local .
docker build --target runtime -f deploy/docker/web.Dockerfile -t clothes-guide-web:local .

kind load docker-image clothes-guide-api:local clothes-guide-api-migration:local clothes-guide-web:local \
  --name clothes-guide-dev
kubectl apply -k deploy/k8s/local
kubectl rollout status -n clothes-guide-dev statefulset/clothes-guide-postgres --timeout=5m
kubectl rollout status -n clothes-guide-dev deployment/clothes-guide-redis --timeout=5m

kubectl create job clothes-guide-local-migration \
  -n clothes-guide-dev \
  --image=clothes-guide-api-migration:local \
  --image-pull-policy=Never \
  -- pnpm --dir apps/api exec mikro-orm migration:up --config ./dist/mikro-orm.config.js
kubectl wait -n clothes-guide-dev --for=condition=complete --timeout=10m job/clothes-guide-local-migration

kubectl create job clothes-guide-local-seed \
  -n clothes-guide-dev \
  --image=clothes-guide-api-migration:local \
  --image-pull-policy=Never \
  -- pnpm --dir apps/api exec mikro-orm seeder:run --config ./dist/mikro-orm.config.js
kubectl wait -n clothes-guide-dev --for=condition=complete --timeout=10m job/clothes-guide-local-seed

kubectl rollout status -n clothes-guide-dev deployment/clothes-guide-api --timeout=10m
kubectl rollout status -n clothes-guide-dev deployment/clothes-guide-web --timeout=10m
```

每次重跑时先移除本地已完成的 one-off Jobs，再重新创建：

```bash
kubectl delete job -n clothes-guide-dev clothes-guide-local-migration clothes-guide-local-seed --ignore-not-found
```

访问服务：

```bash
kubectl port-forward -n clothes-guide-dev service/clothes-guide-web 8080:80
```

打开 `http://localhost:8080`。管理员邮箱为 `admin@clothes-guide.local`；首次生成的密码
保存在本地 Kubernetes Secret 中，可通过以下命令读取：

```bash
kubectl get secret clothes-guide-api-env -n clothes-guide-dev \
  -o jsonpath='{.data.SEED_ADMIN_PASSWORD}' | base64 -d
printf '\n'
```

将该凭据仅用于此本地集群。LLM 使用禁用占位配置，因此登录和本地数据库功能可用，
聊天模型调用不可用。
