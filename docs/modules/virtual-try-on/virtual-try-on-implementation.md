# AI 虚拟试穿实施文档

## 状态与上下文

- 状态：用户于 2026-11-09 确认实施计划。
- 实现状态：已进入集成验证；功能代码、Migration、测试、依赖和配置已创建。
- 最后更新：2026-11-09。
- 关联文档：[PRD](./virtual-try-on-prd.md)、[设计](./virtual-try-on-design.md)、[CRUD 契约](../../contracts/virtual-try-on-crud-contract.md)、[技术文档](./virtual-try-on-technical.md)。
- 前置审批：PRD、设计、CRUD 契约、技术文档及本实施计划均已由用户确认。

## 开发流程总览

1. 用户已确认本实施计划。
2. 主代理完成实现前检查，处理本文件“风险和停止条件”中影响安全、接口或目录边界的未决项；如果需要改变已确认技术方案，先更新技术文档并重新取得确认。
3. 主代理按明确文件所有权派发后端核心、供应商/存储适配和前端体验等互不重叠的任务。
4. 主代理负责共享配置、商品目录公开端口、数据库迁移、模块注册、路由与导航接线，以及跨代理集成。
5. 主代理逐项审查子代理报告和差异，完成单元、HTTP、数据库、构建与仓库级验证。
6. 仅使用具名可销毁数据库执行迁移和 PostgreSQL 验证；外部模型验证仅使用合成/公开测试图片。
7. 完成可运行的用户路径 Smoke Test，记录未完成项和外部依赖限制后交付。

## 子代理角色和文件所有权

实施计划已确认并按文件所有权使用子代理。各代理开始前重新阅读 PRD、设计、契约、技术文档和本实施文档；只可修改分配范围，不得更改其他代理拥有的文件。主代理处理跨模块共享文件和冲突。

### 主代理：集成、共享边界与最终验证

独占所有权：

- `apps/api/src/app.module.ts` 及模块注册、跨模块配置和共享 DI 接线。
- 商品目录侧公开 `ProductCatalogTryOnPort` 的实现和导出；不得让试穿模块引用目录私有 Entity/Repository。
- Migration、Migration 快照或仓库要求的数据库元数据。
- 根目录 `.env.example`、环境配置 Schema、根/应用包依赖清单和 `pnpm-lock.yaml`。
- 现有商品卡公共入口的集成点、账号导航/路由接线，以及需要跨页面协调的文件。
- 任何不在其他角色明确所有权中的共享文件。

职责：

- 检查本地依赖、版本和官方文档，再决定是否增加 `sharp`；验证 Nest multipart、Multer、MikroORM/PostgreSQL、Qiniu 及所选图像接口的实际行为。
- 按已确认方案实现商品投影、配置安全闸门、Migration 与模块接线。
- 审核并集成各子代理改动，解决 API 类型、模块依赖和错误映射冲突。
- 运行全套验证，确保默认开发/生产设置不会接收真实用户人像。

### 后端核心代理：试穿领域模块

独占所有权：

- `apps/api/src/virtual-try-on/virtual-try-on.module.ts`
- `apps/api/src/virtual-try-on/controller/`
- `apps/api/src/virtual-try-on/dto/`
- `apps/api/src/virtual-try-on/entity/`
- `apps/api/src/virtual-try-on/port/product-catalog-try-on.port.ts`
- `apps/api/src/virtual-try-on/service/try-on-photo.service.ts`
- `apps/api/src/virtual-try-on/service/try-on-task.service.ts`
- `apps/api/src/virtual-try-on/service/try-on-quota.service.ts`
- `apps/api/src/virtual-try-on/service/try-on-notification.service.ts`
- `apps/api/src/virtual-try-on/task/`
- 对应 `spec/` 中 Schema、照片、任务、额度和 HTTP 测试。

职责：

- 实现资源归属校验、Zod 参数校验、稳定错误响应、照片和任务状态、活动任务约束、额度与通知。
- 复用现有 JWT、`@CurrentUser()`、请求校验 Pipe 和项目模块惯例。
- 保证网络/供应商调用不处于数据库事务中，完成状态和额度记账遵守技术文档定义的事务边界。
- 只通过公开端口依赖商品目录、对象存储及图像供应商。

### 供应商与对象存储代理：外部 I/O 适配

独占所有权：

- `apps/api/src/virtual-try-on/port/try-on-image-provider.port.ts`
- `apps/api/src/virtual-try-on/port/try-on-object-store.port.ts`
- `apps/api/src/virtual-try-on/service/try-on-worker.service.ts`
- `apps/api/src/virtual-try-on/service/try-on-object-cleanup.service.ts`
- `apps/api/src/virtual-try-on/service/qiniu-try-on-object-store.service.ts`
- `apps/api/src/virtual-try-on/service/openai-compatible-try-on-provider.service.ts`
- `apps/api/src/virtual-try-on/service/image-processing.service.ts`（若依赖文档和实际实现确认需要独立服务）
- `apps/api/src/virtual-try-on/spec/try-on-provider.spec.ts`
- `apps/api/src/virtual-try-on/spec/try-on-object-store.spec.ts`
- worker、图片处理及清理服务对应的测试文件。

职责：

- 实现图片解码、动画拒绝、EXIF 清理、尺寸/格式限制和安全的结果输出处理。
- 实现受控的图像供应商调用、一次临时错误重试、超时取消和响应校验；禁止记录输入图片、Base64、签名 URL、供应商原文或密钥。
- 实现私有 Qiniu 命名空间、限时下载授权、幂等删除和可重试清理。
- 实现基于数据库租约的任务抢占与恢复；不能在事务中等待外部网络。
- 不修改配置 Schema、环境样例、包清单、Migration 或应用注册文件；将所需配置和 DI 接线以报告交给主代理。

### 前端代理：商品卡交互与“我的试穿”

独占所有权：

- `apps/web/src/api/modules/try-on.ts`
- `apps/web/src/api/types/try-on.ts`
- `apps/web/src/pages/my-try-ons/`
- `apps/web/src/pages/chat/components/ChatProductResults.vue` 中约定范围内的试穿事件和入口呈现；如其他商品卡也需要入口，由主代理负责共享集成。
- 此任务需要新增的前端私有组件及对应页面状态文件。

职责：

- 使用现有 Axios 封装、shadcn-vue、Lucide、路由和认证约定，不在页面内散落请求或重复鉴权。
- 实现颜色选择、处理说明与同意、上传/保存照片、排队/处理中/成功/失败、历史、未读状态、下载和删除状态。
- 页面状态留在 `page.ts`，处理取消请求/过期响应、重复提交防护、加载/空/错误/提交状态和卸载清理。
- 不接收或持久化用户全局照片/任务 Store，不显示他人结果，不绕过服务端同意和生产安全闸门。

## 子代理开始前检查

- 工作树、对应文件所有权和当前未提交变更已检查；不得覆盖用户已有内容。
- 对照设计、CRUD 契约和技术文档确认没有新增或隐式更改 API、权限、留存和删除语义。
- 阅读当前 checkout 的相关模块和依赖文档，不直接照搬其他功能实现。
- 确认开发凭据只从服务端环境读取；不得将已披露的密钥写入文档、代码、测试、前端变量或日志。
- 后端所有 API Body、Query、Param 使用现有 Zod 与 `StandardSchemaValidationPipe`；新增代码必要注释使用中文。
- 测试不使用真实用户照片、生产凭据、默认开发数据库或不可控的第三方网络。
- 任何需要改变已确认决策的任务暂停并报告，不自行拓展契约。

## 子代理完成报告

每位代理必须报告：

```text
修改文件
执行命令及结果
测试结果与未执行项
未解决风险
越界修改或冲突
主代理需要的配置/DI/API 接线
```

主代理逐项核对文件范围、业务契约、密钥/人像数据边界、中文必要注释和测试质量。未报告的代码不得视为已验证。

## 主代理集成任务

- 汇总本地依赖调查和当前版本官方文档结论，确认 `sharp`、multipart 限制、Qiniu 签名/删除、供应商响应格式与超时行为；修正文档冲突时先重新走受影响文档审批。
- 建立明确的开发测试图片准入方式。无法可靠区分真实人像时，关闭真实用户照片上传入口，而不是声称依赖提示或客户端标记即可阻断。
- 实现配置验证、服务端密钥注入、默认关闭生产真实人像的闸门，并审查所有日志与错误路径。
- 实现商品目录端口和跨模块 DI；卡片覆盖范围以完成实现前的确认结果为准。
- 审查 Entity 索引、约束、级联/归属规则和 Migration SQL；仅对具名可销毁数据库运行。
- 检查事务中没有外部 I/O、后台任务多实例租约正确、临时照片与保存照片生命周期隔离、额度不会超发。
- 汇总子代理变更，运行格式、类型、测试、构建和仓库检查；执行浏览器端主要路径并记录真实模型是否未测。

## 按顺序排列的实施阶段

1. **实现前复核**：核对入口卡片范围、测试图片准入和供应商隐私闸门；复核本地依赖与官方文档。发现已确认文档间存在不一致时，暂停分工并回到受影响文档审批。
2. **共享基础与存储结构**：主代理实现环境配置、数据库 Migration、商品目录公开端口和模块接线骨架；先运行 Migration 检查和 schema 测试。
3. **后端领域能力**：后端核心代理实现照片资产、任务、额度、授权、API schema 与本人隔离测试。
4. **外部 I/O 与后台处理**：供应商/存储代理实现图像处理、私有对象、工作器、租约恢复、供应商适配和清理重试；使用 Fake 实现验证，不依赖真实服务。
5. **前端体验**：前端代理实现卡片入口及“我的试穿”页面，并接入接口类型与完整异步状态。
6. **集成审查**：主代理统一错误响应、Swagger、模块/路由/导航、响应类型和对象生命周期；修复跨层问题。
7. **自动化验证**：运行 API 单元/HTTP 测试、具名 PostgreSQL 集成测试、前端类型检查、格式检查、构建及仓库检查。
8. **Smoke Test 与交付**：只用合成/公开测试图片完成授权、上传、生成状态、历史、下载、删除路径；不得把单次开发调用描述为生产质量或 SLA 验证。

## 验收标准

- 服装商品卡入口范围与确认后的需求一致；鞋类和任意服装图片不进入任务。
- 服务端按当前商品和有效颜色校验，并按约定选择 SKU 图片或回退主图。
- 未登录、禁用账号、越权、非法输入、未知字段和媒体限制有自动化覆盖。
- 上传图片由服务端解码校验，拒绝动图和不支持格式，清理 EXIF；临时与主动保存照片生命周期隔离。
- 用户本人照片、任务、结果和提醒之间严格授权；越权读取不泄露资源存在性。
- 单用户活动任务和每日 5 次成功额度在并发下可靠；失败不计次且供应商临时错误只重试一次。
- 多 API 实例任务抢占可恢复，不重复产生可见结果；成功结果与任务状态、额度一致提交。
- 私有结果只能本人通过短期授权或流式下载读取；删除先墓碑、后重试清理，无公开对象 URL。
- 页面覆盖 idle/loading/success/empty/error 和提交状态；登录返回商品、同意、任务历史与未读提示行为正确。
- 图片内容、Base64、API Key、对象键、签名 URL 和供应商原始响应不进入日志、聊天、trace 或前端遥测。
- 开发和生产默认不接受未经允许的真实人像；供应商的人像留存、地区、训练用途及删除保障未取得书面确认前，不开放生产真实照片。
- 商品目录、鉴权、聊天和订单既有行为无回归。

## 风险和停止条件

- 供应商没有人像留存、处理地区、训练用途和删除 SLA 的书面保障：生产真实照片能力保持关闭。
- 无法在服务端明确限制开发测试图片为合成/公开样本：关闭照片上传与真实供应商调用，仅继续 Fake/fixture 测试。
- 商品卡入口究竟覆盖聊天卡、商品列表卡或所有现有卡片未能从已确认文件中一致确定：先确认范围并同步 PRD/设计/技术文档，再实现入口。
- 技术文档的 multipart 解析、4xx/413/415 映射、Qiniu 签名与删除语义或图像供应商接口未通过本地依赖/官方文档和测试验证：先修订并重新确认技术文档。
- 任务租约无法保证多实例下可靠恢复，或结果删除不能撤销旧下载能力：停止对应能力上线。
- 发现照片、密钥、签名 URL 或供应商原始响应进入日志/trace：修复并通过回归测试后再继续。
- Migration 只能通过破坏默认开发库的方式验证：停止数据库验证，不执行 `migration:fresh`。

## 审批说明

用户于 2026-11-09 确认本实施计划，重点包括子代理边界、主代理集成责任、实现顺序以及实施前停止条件。若实现复核需要更改已确认技术决策，将先更新并重新确认技术文档。
