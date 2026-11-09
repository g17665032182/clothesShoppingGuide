# AI 虚拟试穿技术文档

## 状态与上下文

- 状态：技术方案已于 2026-11-09 获用户确认。
- 实现状态：已进入实现与验证；业务代码、Migration 和测试已创建。
- 最后更新：2026-11-09。
- 关联文档：[PRD](./virtual-try-on-prd.md)、[设计](./virtual-try-on-design.md)、[CRUD 契约](../contracts/virtual-try-on-crud-contract.md)。
- 前置确认：PRD、设计文档和 CRUD 契约已确认；生产真实人像接入仍受供应商数据处理书面保障阻塞。

## 实现目标

在不改变商品目录、鉴权和订单边界的前提下，实现：

1. 商品卡发起服装试穿、颜色校验和主图回退。
2. 私有照片资产上传、保存、复用和清理。
3. 数据库持久化后台任务，支持进程重启、任务租约恢复和一次自动重试。
4. 通过服务端图像供应商端口调用多图编辑接口，保存私有生成结果。
5. 每用户单活动任务、每日成功 5 次额度和 Asia/Shanghai 日期边界。
6. “我的试穿”页面、站内未读状态、下载和删除。
7. 开发环境使用合成/公开测试图；生产环境默认关闭真实人像输入。

## 目录结构与文件所有权

### 后端

```text
apps/api/src/virtual-try-on/
├── virtual-try-on.module.ts
├── controller/
│   ├── try-on-photo.controller.ts
│   └── try-on-task.controller.ts
├── dto/
│   ├── try-on-param.dto.ts
│   ├── try-on-photo.dto.ts
│   ├── try-on-task.dto.ts
│   └── try-on-response.dto.ts
├── entity/
│   ├── try-on-photo.entity.ts
│   ├── try-on-task.entity.ts
│   ├── try-on-result.entity.ts
│   ├── try-on-quota.entity.ts
│   └── try-on-object-cleanup.entity.ts
├── port/
│   ├── product-catalog-try-on.port.ts
│   ├── try-on-image-provider.port.ts
│   └── try-on-object-store.port.ts
├── service/
│   ├── try-on-photo.service.ts
│   ├── try-on-task.service.ts
│   ├── try-on-quota.service.ts
│   ├── try-on-worker.service.ts
│   ├── try-on-notification.service.ts
│   ├── try-on-object-cleanup.service.ts
│   ├── qiniu-try-on-object-store.service.ts
│   └── openai-compatible-try-on-provider.service.ts
├── task/
│   ├── try-on-task-claim.ts
│   └── try-on-task-backoff.ts
└── spec/
    ├── try-on-schema.spec.ts
    ├── try-on-photo.service.spec.ts
    ├── try-on-task.service.spec.ts
    ├── try-on-provider.spec.ts
    ├── try-on-object-store.spec.ts
    ├── try-on-http.spec.ts
    └── try-on.postgres.spec.ts
```

模块根目录只保留 Module；Controller、DTO、Entity、端口、Service 和测试按现有后端约定归类。模块通过 `ProductCatalogTryOnPort` 获取商品事实，不引用 `product-catalog` 的 Entity 或私有 Repository。

### 前端

```text
apps/web/src/
├── api/
│   ├── modules/try-on.ts
│   └── types/try-on.ts
├── pages/
│   └── my-try-ons/
│       ├── index.vue
│       ├── page.ts
│       └── components/
│           ├── TryOnPhotoPicker.vue
│           ├── TryOnTaskList.vue
│           ├── TryOnTaskDetail.vue
│           └── TryOnConsentDialog.vue
└── pages/chat/components/
    └── ChatProductResults.vue
```

聊天商品卡只新增 `try-on` 事件和入口展示，上传、颜色选择、同意弹窗和任务提交放到页面级逻辑或私有组件。`index.vue` 不直接调用 Axios，不保存全局照片或任务状态。

## 依赖与配置

### 复用的本地依赖

- NestJS `FileInterceptor`/Multer：接收单个 multipart 文件并限制请求体大小。
- Zod 4 + Nest `StandardSchemaValidationPipe`：JSON Body、Query 和 Param 校验。
- MikroORM 7 + PostgreSQL：实体、事务、行锁、部分唯一索引和迁移。
- Qiniu SDK：沿用现有私有对象上传、短期下载授权和幂等删除模式，但使用独立 `try-on/` 前缀。
- Axios、Vue Router、shadcn-vue、Lucide：前端 API、路由和交互。

### 新增开源依赖

- `sharp`：服务端解码图片、读取尺寸/格式、拒绝动图、旋转方向并清理 EXIF。实现前阅读当前版本官方文档并确认 Node 22 构建产物可用。

不新增通用队列、对象存储或鉴权库。后台任务沿用现有用户记忆调度器的数据库抢占和 Nest 生命周期模式。

### 配置

计划在 `apps/api/.env.example` 增加：

```text
TRY_ON_ENABLED=false
TRY_ON_REAL_PHOTOS_ENABLED=false
TRY_ON_PROVIDER=openai-compatible
TRY_ON_BASE_URL=
TRY_ON_API_KEY=
TRY_ON_MODEL=gpt-image-2.6-flare
TRY_ON_TIMEOUT_MS=150000
TRY_ON_MAX_FILE_BYTES=10485760
TRY_ON_MAX_EDGE=4096
TRY_ON_DOWNLOAD_URL_TTL_SECONDS=300
TRY_ON_QUOTA_TIME_ZONE=Asia/Shanghai
TRY_ON_POLL_INTERVAL_MS=2000
TRY_ON_PROCESSING_TIMEOUT_MS=180000
TRY_ON_RETENTION_PREFIX=try-on
```

`TRY_ON_REAL_PHOTOS_ENABLED=false` 是生产安全闸门。启用前必须完成供应商留存、地区、训练用途和删除 SLA 审查；开发环境只能用合成或公开测试图。真实 API Key 只通过 API 进程环境变量读取，不进入前端 Vite 环境、Git、Swagger 示例或日志。

## 接口与依赖注入

### 商品目录端口

新增 `PRODUCT_CATALOG_TRY_ON_PORT`，输入 `productExternalId`，返回：

```ts
type TryOnProductProjection = {
  productExternalId: string;
  productName: string;
  category: 'tops' | 'bottoms' | 'dresses' | 'outerwear' | 'shoes';
  mainImageUrl: string | null;
  colors: Array<{
    color: string;
    imageUrl: string | null;
  }>;
};
```

实现由 `product-catalog` 提供，服务端完成：

- 仅读取启用商品和启用 SKU；
- 按颜色去重并保持稳定排序；
- 优先选择该颜色的安全公开 SKU 图片；
- 所有颜色图片为空时返回商品主图；
- 试穿模块再拒绝 `shoes`，避免将商品目录事实和试穿规则重复写入目录模块。

### 图片供应商端口

```ts
export const TRY_ON_IMAGE_PROVIDER = Symbol('TRY_ON_IMAGE_PROVIDER');

export interface TryOnImageProvider {
  generate(input: {
    person: Buffer;
    garment: Buffer;
    model: string;
    prompt: string;
    signal: AbortSignal;
  }): Promise<{
    image: Buffer;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    providerRequestId: string | null;
  }>;
}
```

`OpenaiCompatibleTryOnProvider` 使用 Node `fetch` 调用 `{TRY_ON_BASE_URL}/images/edits`，发送 `image[]` 两张图片、`model`、固定试穿提示词、`size=auto` 和 `n=1`。响应只接受 Base64 图片字段，立即解码并限制输出大小；不把供应商 URL 持久化。

供应商错误分类：

- 429、5xx、连接错误、超时：`TRANSIENT_PROVIDER_ERROR`，最多重试一次；
- 4xx 输入拒绝或内容政策拒绝：`PROVIDER_REJECTED`，不重试；
- 响应结构、Base64 或图片解码非法：`INVALID_PROVIDER_OUTPUT`，不重试；
- 超过配置超时：`PROVIDER_TIMEOUT`，按临时错误重试一次。

### 对象存储端口

```ts
export const TRY_ON_OBJECT_STORE = Symbol('TRY_ON_OBJECT_STORE');

export interface TryOnObjectStore {
  putPhoto(input: {
    userId: string;
    id: string;
    body: Buffer;
    mimeType: string;
  }): Promise<string>;
  putResult(input: {
    userId: string;
    id: string;
    body: Buffer;
    mimeType: string;
  }): Promise<string>;
  getPrivateDownloadUrl(objectKey: string, ttlSeconds: number): Promise<string>;
  deleteObject(objectKey: string): Promise<void>;
}
```

Qiniu 实现只接受模块生成的键：

```text
try-on/{userId}/photos/{photoId}.{ext}
try-on/{userId}/results/{resultId}.{ext}
```

使用 HTTPS 私有域名、5 分钟下载授权和幂等删除；对象不存在视为删除成功。物理删除失败写入 `TryOnObjectCleanup`，由独立清理服务按小时重试。

## Entity、索引与事务

### `TryOnPhoto`

字段：`id`、`userId`、`kind`、`status`、`objectKey`、`mimeType`、`byteSize`、`width`、`height`、`expiresAt`、`taskId`、`createdAt`、`updatedAt`、`deletedAt`。

索引：

- `(user_id, kind, status, created_at)`：本人保存照片列表；
- `(status, expires_at)`：临时照片清理；
- `object_key unique`：阻止对象重复登记。

### `TryOnTask`

字段：`id`、`userId`、`status`、`productExternalId`、`productName`、`productCategory`、`color`、`garmentImageUrl`、`sourcePhotoId`、`consentVersion`、`consentedAt`、`attempts`、`availableAt`、`lockedAt`、`failureCode`、`providerModel`、`providerRequestId`、`notificationReadAt`、`createdAt`、`updatedAt`、`completedAt`、`deletedAt`。

索引与约束：

- `(user_id, created_at desc)`：历史分页；
- `(status, available_at, created_at)`：后台抢占；
- `(user_id) WHERE status IN ('queued','processing')`：每人单活动任务；
- `source_photo_id` 外键或等价归属约束；
- `consent_version` 必填，不保存同意文本正文。

### `TryOnResult`

字段：`id`、`taskId`、`userId`、`objectKey`、`mimeType`、`byteSize`、`width`、`height`、`createdAt`、`deletedAt`。

约束：`task_id unique`、`object_key unique`、`user_id` 与任务归属一致。

### `TryOnQuota`

字段：`userId`、`quotaDate`（PostgreSQL `date`，按 `Asia/Shanghai` 计算）、`successCount`、`createdAt`、`updatedAt`。

约束：`(user_id, quota_date) unique`。成功结果提交事务中锁定当天记录，只有 `successCount < 5` 才递增。

### `TryOnObjectCleanup`

字段：`id`、`userId` 可空、`objectKey`、`attempts`、`nextAttemptAt`、`lastErrorCode`、`createdAt`。

对象物理删除失败不回滚已经对用户隐藏的墓碑状态；清理服务持续重试并限制日志频率。

### 事务边界

1. 上传照片：文件校验、对象上传、照片登记；登记失败必须安排对象清理。
2. 创建任务：锁定用户活动任务/额度、读取商品投影、验证照片归属与同意版本、登记任务；不在事务内调用供应商。
3. 抢占任务：`FOR UPDATE SKIP LOCKED` 将 `queued` 改为 `processing`，增加 attempts 和 lease 时间。
4. 成功提交：上传结果对象后，在事务中创建 `TryOnResult`、标记任务成功、清理临时照片引用、递增额度并生成未读状态。
5. 最终失败：记录稳定失败码、标记任务失败、清理临时照片；不递增额度。
6. 删除结果：写任务/结果墓碑，撤销下载能力，安排对象物理删除。

## 后台任务执行

`TryOnWorkerService` 实现 `OnModuleInit`/`OnModuleDestroy`，每 2 秒轮询一次，模式参考 `UserMemorySchedulerService`：

1. `recoverExpiredProcessing()` 将超过 180 秒租约的 `processing` 任务改回 `queued` 或转最终失败。
2. 在短事务中用 `FOR UPDATE SKIP LOCKED` 批量抢占最多 2 个任务。
3. 为每个任务创建独立 `RequestContext` 和 `AbortController`，读取私有照片与商品图片。
4. 调用供应商端口；网络和供应商调用不持有数据库事务。
5. 结果通过 `sharp` 解码、旋转、清理元数据并写入私有对象。
6. 使用成功/失败事务完成状态转换；进程退出时清理定时器并等待当前工作。

同一数据库允许多 API 实例运行，抢占锁保证不重复处理；不引入 Redis。若未来任务量超过数据库轮询能力，再单独立项引入队列。

## 请求 Schema、校验与错误映射

Schema 放在 `dto/try-on-task.dto.ts`、`dto/try-on-photo.dto.ts` 和 `dto/try-on-param.dto.ts`，类型从 Zod 派生：

- `createTryOnTaskSchema`：严格对象，`productExternalId`、`color`、`photoId`、`consentVersion`；
- `tryOnTaskQuerySchema`：`page`/`pageSize` 使用 `z.coerce.number()` 后输出整数，`status` 枚举，`unread` 使用布尔转换；
- `tryOnUuidParamSchema`：严格 UUID 路由参数；
- `emptyTryOnActionSchema`：严格空对象；
- `photoSaveSchema`：multipart 的 `save` 字段先由 Multer 字符串解析，再进入严格布尔转换；
- 文件校验不依赖 Zod：`FileInterceptor` 先限制内存文件大小，`sharp` 再校验实际格式、动画页数、像素和 EXIF。

Controller 使用 `@Body({ schema })`、`@Query({ schema })`、`@Param({ schema })`；全局 `StandardSchemaValidationPipe` 负责 400。文件为空、格式不符、大小/像素越界映射 400/413/415，具体平台映射在实现测试中固定。

## 安全和可观测性

- `@CurrentUser()` 是唯一用户来源；所有读写 Service 再次校验归属。
- 任务详情、下载和删除统一按 404 隐藏越权资源。
- 日志只记录 taskId、状态、耗时、attempts、failureCode；禁止图片、Base64、对象键、签名 URL、供应商原文和 API Key。
- 供应商请求不包含用户账号、聊天正文、订单或长期记忆。
- `TRY_ON_REAL_PHOTOS_ENABLED=false` 时，服务端拒绝生产真实人像任务；开发测试需使用标记为公开测试的图片。
- 结果下载响应使用短期授权或 API 流，不设置公开缓存；响应头禁止跨域暴露签名地址。

## 测试方案

### 单元测试

- Zod 合法/非法边界、未知字段、转换结果和空 Body。
- 图片格式、10 MiB、4096 像素、动图、EXIF 清理和解码失败。
- 商品类别拒绝、颜色图片选择和主图回退。
- 供应商成功、429/5xx/超时重试、4xx 拒绝和非法 Base64。
- Qiniu 适配器上传、5 分钟签名、612 删除幂等和清理重试。
- 额度成功递增、失败不计次和 Asia/Shanghai 日期边界。

### HTTP/数据库测试

- 登录/禁用账号、本人隔离和越权 404。
- multipart 上传和 JSON task schema 的 400/413/415 行为。
- 单用户活动任务唯一、每日第 6 次拒绝、并发创建竞争。
- 任务后台状态迁移、租约恢复、一次重试和最终失败。
- 成功结果、临时照片删除、保存照片复用、结果下载和删除。
- 站内未读状态、标记已读、分页和空态。
- 迁移在具名可销毁 PostgreSQL 测试库执行；不使用默认开发库的 `migration:fresh`。

### 前端测试

当前仓库尚未安装 Vitest、Vue Test Utils 或 Playwright，技术阶段只记录测试边界，不提前新增测试基础设施。实现时至少补充 API 适配器、页面状态和关键组件测试；浏览器级验证覆盖商品卡入口、登录返回、同意、上传、后台轮询、下载和删除。

## 验证命令

实现阶段至少执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm check
```

涉及数据库时，使用具名可销毁测试库执行增量迁移、PostgreSQL 测试和任务清理验证；报告供应商真实调用未执行或仅使用公开测试图，不把模拟调用写成生产验收。

## 风险和停止条件

- 渠道没有人像留存、地区、训练用途和删除 SLA 的书面保障：停止生产真实照片接入。
- 供应商接口不能稳定接受两张图片或响应不是可解码图片：停止模型适配，不能回退为伪造结果。
- Qiniu 私有删除无法提供重试和可审计状态：停止永久结果上线。
- 数据库任务租约无法在多实例下避免重复处理：停止后台任务上线。
- 任一测试发现照片、签名 URL、密钥或供应商原文进入日志/trace：修复后才可继续。

## 审批说明

用户已于 2026-11-09 确认本技术文档及后续实施计划；代码已按该方案进入实现和验证阶段。生产真实人像仍须等待供应商书面隐私保障。
