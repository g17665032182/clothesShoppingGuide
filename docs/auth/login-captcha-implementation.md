# 登录验证码实施文档

## 状态

- 状态：已实施
- 实施依据：用户已确认本实施文档。

## 开发流程总览

1. 在 API 认证模块内新增验证码 Provider、挑战存储和验证码服务。
2. 接入公开验证码获取接口，扩展登录 DTO 与认证服务校验。
3. 在 Web API 类型和适配器中接入验证码接口。
4. 在登录页展示验证码、60 秒获取倒计时和失败状态。
5. 补充后端 Provider、Store、认证流程和 DTO 测试，以及前端页面逻辑测试边界。
6. 由主代理集成、格式化、类型检查、构建、测试和差异审查。

## 文件所有权

本任务规模适中，不拆分并行子代理；主代理负责所有跨模块接线和最终验证，避免多个代理同时修改认证入口。

后端文件：

- `apps/api/package.json`、`pnpm-lock.yaml`：新增并锁定 `svg-captcha` 依赖。
- `apps/api/src/auth/captcha/captcha-provider.ts`：验证码 Provider 合约。
- `apps/api/src/auth/captcha/service/captcha-challenge.store.ts`：带 TTL、容量上限和一次性消费的内存存储。
- `apps/api/src/auth/captcha/service/image-captcha.provider.ts`：调用 `svg-captcha` 生成 SVG，并保存答案摘要。
- `apps/api/src/auth/captcha/service/captcha.service.ts`：编排生成、校验和统一错误。
- `apps/api/src/auth/captcha/dto/captcha-response.dto.ts`：验证码响应模型。
- `apps/api/src/auth/captcha/captcha.module.ts`：注册 Provider、Store 和 Service。
- `apps/api/src/auth/controller/auth.controller.ts`：增加验证码获取路由和响应头。
- `apps/api/src/auth/dto/login.dto.ts`：增加验证码字段及校验。
- `apps/api/src/auth/service/auth.service.ts`、`apps/api/src/auth/auth.module.ts`：接入验证码校验能力。
- `apps/api/src/auth/spec/`：验证码和登录流程测试。

前端文件：

- `apps/web/src/api/types/auth.ts`：增加验证码响应和登录请求字段。
- `apps/web/src/api/modules/auth.ts`：增加获取验证码请求适配器。
- `apps/web/src/pages/auth/page.ts`：验证码状态、刷新倒计时、请求生命周期和登录参数。
- `apps/web/src/pages/auth/index.vue`：验证码图片、输入框、刷新按钮和倒计时展示。

不修改：

- 用户 Entity、数据库迁移、Seeder、注册接口和 Refresh Token 数据结构。
- 全局 `src/common/`，验证码能力属于认证模块。

## 子代理开始前检查

- 确认 `svg-captcha` 版本、许可证和锁文件变更；不引入未审查的替代包。
- 确认现有 `ApiRequestOptions`、全局 `ValidationPipe` 和 Swagger 配置可直接复用。
- 确认登录页当前未提交修改，保留已完成的登录成功跳转 `/chat`。
- 确认验证码答案、输入和 Token 不写入日志。
- 确认单实例内存存储限制写入技术注释和部署说明，不伪装成多实例方案。

## 主代理集成任务

- 将验证码模块注册到 `AuthModule`，不把业务专属 Provider 放入 `common/`。
- 确保登录先消费并验证验证码，再执行密码比较；任何失败均不创建 Refresh Token。
- 统一验证码无效错误，避免泄露不存在、过期和重复消费的具体原因。
- 为 Swagger 补齐验证码接口、登录字段和错误响应。
- 确认前端倒计时只有一个活动计时器，刷新、卸载和请求失败时状态一致。
- 检查 `pnpm check` 不会将 `.agents/` 或 `.agent/` 内容作为业务源文件处理；不得修改 agent 文件以绕过检查。

## 按顺序排列的实施阶段

### 阶段一：后端验证码能力

- 新增 Provider 合约、内存 Store、图片 Provider 和验证码 Service。
- 使用密码学安全随机挑战 ID；答案仅保存摘要或不可逆校验材料。
- 实现 5 分钟 TTL、提交即消费、容量上限和过期清理。

### 阶段二：认证接口接入

- 新增 `GET /api/auth/captcha`，设置 `Cache-Control: no-store`。
- 扩展 `LoginDto` 为 `captchaChallengeId`、`captchaAnswer`。
- 在 `AuthService.login` 中先验证验证码，再执行现有邮箱密码校验。
- 保持成功响应、Refresh Token Cookie 和现有错误语义。

### 阶段三：前端登录体验

- 登录模式下仅用户点击获取时加载验证码；进入登录页和注册模式均不自动请求验证码。
- 展示 SVG data URI、验证码输入框和刷新控件。
- 首次进入不加载图片，用户点击获取或刷新成功后启动 60 秒倒计时；获取方法也检查冷却和请求状态，防止重复获取。
- 使用 `onUnmounted` 清理计时器；旧请求响应不得覆盖新挑战。
- 登录失败后清空已消费的验证码，不自动换图、不重置已有倒计时；由用户在冷却结束后再次点击获取。

### 阶段四：测试和验证

- 先运行认证模块测试和前端类型检查，再运行构建与全仓库检查。
- 有可用 API 和数据库时执行登录验证码 Smoke Test；不使用真实第三方密钥。
- 检查 OpenAPI 元数据包含验证码路由和登录字段。

## 验收标准

- [x] 未获取验证码或验证码无效时，登录不会创建访问令牌和 Refresh Token。
- [x] 正确验证码与正确密码可正常登录，并跳转 `/chat`。
- [x] 图片验证码获取接口不返回答案，响应禁止缓存。
- [x] 验证码 5 分钟过期，提交一次后不可重复使用。
- [x] 首次进入不加载图片，用户点击获取成功后 60 秒内获取/刷新控件禁用，计时器卸载时清理。
- [x] 注册、刷新 Token、退出登录和用户资料流程不受影响。
- [x] Provider 边界允许未来接入第三方验证码，不要求修改 `AuthService` 的核心认证流程。
- [x] 测试不访问真实第三方服务，不记录验证码答案或用户凭据。

## 风险和停止条件

- `svg-captcha` 依赖审查或安装失败时停止实现，先重新确认替代库，不手写 SVG 生成器。
- 若部署要求多 API 副本，停止使用内存 Store，回到技术设计阶段确认共享存储。
- 若需要服务端限流、第三方 Provider 或注册验证码，回到设计文档重新确认范围。
- 若全局检查因 `.agents/`、`.agent/` 等文档目录产生误报，保留原始错误并调整检查配置，而不是修改业务代码或删除文档。
