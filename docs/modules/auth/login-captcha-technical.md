# 登录验证码技术文档

## 状态与上下文

- 状态：已实现；Redis 共享存储适配器已加入，Kubernetes 通过环境变量启用
- 关联设计：[登录验证码设计文档](./login-captcha-design.md)
- 关联契约：[用户与认证业务契约](../../contracts/user-crud-contract.md)
- 所属模块：`apps/api/src/auth`、`apps/web/src/pages/auth`
- 最后更新：2026-10-31

## 实现目标

- 登录页获取并显示 SVG 图片验证码，用户可刷新图片。
- API 在调用邮箱密码认证前验证验证码；验证码失败时不得创建任何登录会话或 Cookie。
- 验证码挑战与答案保存在服务端短期存储中，接口及日志不暴露答案。
- 认证模块通过 Provider/适配器边界隔离验证码能力，未来可接入第三方服务；本阶段仅实现图片 Provider。
- 不改注册、Token 刷新、退出登录和既有登录成功响应。

## 包和目录结构

建议实现后按以下职责放置文件，避免在认证根目录扩张业务细节：

```text
apps/api/src/auth/
  captcha/
    captcha.module.ts
    captcha-provider.ts
    service/
      captcha.service.ts
      image-captcha.provider.ts
      captcha-challenge.store.ts
      redis-captcha-challenge.store.ts
    dto/
      captcha-response.dto.ts
  controller/
    auth.controller.ts
  dto/
    login.dto.ts

apps/web/src/
  api/modules/auth.ts
  api/types/auth.ts
  pages/auth/
    index.vue
    page.ts
```

`captcha/` 仅由认证模块拥有；Provider 不依赖 Vue、Controller 或用户 Entity。避免为单个 API 响应类型重复建立通用 DTO 层级，最终目录可在实施文档阶段按现有模块风格收敛。

## 依赖和官方文档

- 本地依赖检查未发现可复用的 Redis 客户端；已新增固定版本 `redis@6.3.1`，仅使用 node-redis 的基础连接、`SET` 和 `GETDEL` 命令。
- 拟采用 `svg-captcha` 生成图片，不让该库管理登录会话或验证码状态。其上游 README 说明 `create()` 返回 SVG 数据和验证码文本，生成图像使用 SVG，不需要 C++ 图形插件：[svg-captcha 上游文档](https://github.com/produck/svg-captcha)。
- 维护风险：上游仓库长期缺少活跃维护。该库只作为可替换的 SVG 渲染器使用；实施前需复核锁定版本、依赖树、许可证和安全扫描。若项目不接受此维护状态，应先选定替代包再进入实施。
- NestJS、Vue 与现有 API 层均复用当前依赖，不需新增验证码相关前端依赖。

## 接口和依赖注入

### 获取挑战

- `GET /api/auth/captcha`
- 响应建议：`{ challengeId: string, imageData: string, type: 'image' }`，其中 `imageData` 为 SVG data URI。
- 响应设置 `Cache-Control: no-store`，避免浏览器或代理缓存短期挑战。
- 每次获取创建新挑战，不在响应中返回答案。

### 提交登录

- 扩展登录 DTO：`captchaChallengeId: string`、`captchaAnswer: string`。
- 用户名密码和验证码均通过后，才进入现有会话创建逻辑。
- 前端登录页通过现有 `src/api/modules/auth.ts` 请求适配器调用获取验证码接口；页面不直接调用 Axios。
- 首次进入页面不请求、不显示图片，用户点击获取或刷新成功后才启动 60 秒倒计时。登录请求失败后清空已消费的验证码，清理计时器并将倒计时归零，不自动请求新挑战，允许用户立即手动获取；本地缺少验证码的校验失败不清空图片或解除冷却。其他情况下倒计时期间禁用获取/刷新操作，计时器在页面卸载时清理。

### Provider 扩展点

- 认证验证码接口采用模块内 Provider 合约，例如 `issueChallenge()` 和 `verifyChallenge(input)`。
- `ImageCaptchaProvider` 负责生成 SVG 和委托挑战状态存储；后续第三方 Provider 可封装供应商 SDK/API，不把供应商逻辑放入 `AuthService`。
- 当前公开字段使用 `type: 'image'`；第三方接入时需定义其请求与前端交互载荷，再扩展校验 DTO。当前不接受任意 provider 字符串，也不暴露供应商密钥。

## 状态、流程或持久化

已确认的挑战规则：

- 挑战有效期：5 分钟。
- 挑战为一次性；第一次提交即消费，无论答案正确与否，避免重复猜测同一挑战。
- 答案比较前去除首尾空白并转成小写；错误答案不区分大小写。
- 挑战到期、刷新图片、验证码错误后，用户手动获取新挑战，不自动请求。
- 手动获取或刷新成功后的冷却倒计时固定为 60 秒，只约束当前页面的手动操作，不等同于服务端频率限制；本阶段不要求服务端返回 `retryAfter`。
- 验证码状态不写入用户表，不需要 MikroORM Entity 或数据库迁移。

存储方案：

- `CAPTCHA_STORAGE=memory`（默认）继续使用认证模块私有、带容量上限的内存存储，仅适用于本地开发和不涉及多实例的测试。
- `CAPTCHA_STORAGE=redis` 时使用 `CAPTCHA_REDIS_URL` 和至少 32 字符的 `CAPTCHA_HMAC_SECRET`。答案以绑定挑战 ID 的 HMAC 摘要存储，不保存明文；写入使用 `SET NX EX 300`，消费使用 Redis 6.2+ 的 `GETDEL` 原子读取并删除。
- Redis 连接或命令失败统一映射为 `503`，不回退到进程内存或放行登录；无效、过期、错误和已消费挑战继续使用现有验证码错误。所有 API 副本必须使用同一 HMAC 密钥。
- 登录和验证码接口本阶段不增加服务端频率限制，后续作为独立安全能力评估。

## DTO、校验和错误映射

- 使用 Zod 请求 schema，并由 Nest `StandardSchemaValidationPipe` 完成请求校验。
- `captchaChallengeId` 必须为非空字符串且长度受限；`captchaAnswer` 必须为非空字符串且最大长度与生成字符数一致。
- 不存在、过期、重复消费或错误的挑战统一返回通用 `400` 或 `401` 错误，不指出挑战处于哪种无效状态。
- 账号密码错误继续沿用现有 `401` 语义，响应不泄露账号是否存在。
- 图片生成失败映射为通用 `503 ServiceUnavailableException`；内部异常不透传。
- Swagger 为新增 GET 和登录字段补齐请求、响应和错误说明。

## 安全和可观测性

- 图片验证码仅是自动化滥用的低成本门槛，不能替代 MFA、密码喷洒防护或登录限流。
- 答案只保留在服务端短期状态中，不放入 URL、日志、响应字段或前端状态持久化。
- `imageData` 仅承载图形，不包含答案、签名秘密或可解码答案的元数据。
- 挑战 ID 使用密码学安全随机数生成；答案比较采用恒定时间比较，或先对答案做带服务端随机盐的摘要后比较。
- 新增错误日志仅记录错误类别和请求关联信息，不记录答案、图像内容、凭据或验证码输入。
- 生产部署若采用共享状态，需确认挑战 key TTL、原子消费能力、故障降级和访问凭据管理；不将验证码答案明文持久化。
- Render 测试/生产和 Kubernetes API Deployment 必须显式使用 `CAPTCHA_STORAGE=redis`，
  并为 Redis 和 HMAC 密钥创建独立的环境 Secret；生产、测试不能共用。

## 测试方案

- Provider：图像生成结果、答案不进入响应、字符归一化、错误/过期/重复挑战拒绝、一次性消费。
- Store：TTL 到期清理、容量上限、并发消费只成功一次。
- AuthService：无效验证码时不执行密码比较与会话创建；验证码有效但凭据错误时不创建会话；两者有效时保持既有响应。
- Controller/DTO：公开路由、DTO 非空/长度校验、Swagger 元数据和错误映射。
- Web：首次进入不获取、手动获取与冷却、提交中、验证码失败后立即手动获取新挑战、本地校验不解除冷却、登录成功及获取失败状态。
- 测试使用确定性 Provider/Store 替身，不访问外部验证码服务、不使用真实密钥或生产服务。
- Redis 集成测试在显式提供 `REDIS_CAPTCHA_TEST_URL` 时运行，使用两个独立 Store 验证跨实例读取和一次性消费；未提供时按跳过统计，不把跳过记为通过。

## 验证命令

实施完成后执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
pnpm check
```

## 已确认决策

- [x] 使用 `svg-captcha` 作为图片验证码生成器，并保留 Provider/适配器替换入口。
- [x] 挑战有效期 5 分钟，提交即一次性消费，答案比较不区分大小写。
- [x] 单实例默认使用认证模块私有内存存储；Kubernetes 多副本使用 Redis 共享存储。
- [x] 本阶段不增加验证码与登录服务端限流。
- [x] `GET /auth/captcha` 返回 SVG data URI，登录字段为 `captchaChallengeId`、`captchaAnswer`。
- [x] 首次进入不加载图片，仅用户点击获取或刷新成功后倒计时 60 秒，页面卸载时清理并重置状态。

## 实施记录

- 内存 Store、Redis Store、Provider 接线和自动化测试已实现。
- Redis 集成测试仅在显式提供临时 Redis 地址时运行；真实 Kubernetes/Redis 验收仍需在目标环境执行。
