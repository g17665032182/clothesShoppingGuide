# 后端开发约定

适用于 `apps/api/src/`。业务模块按领域组织，模块内部维护 Controller、Service、Entity、DTO、测试和辅助组件；根目录保持精简。常见职责目录为 `controller/`、`service/`、`entity/`、`dto/`、`spec/`，多个紧密协作能力可使用有业务含义的子目录。跨模块调用走公开入口或 Port，不引用其他模块的 Entity、Repository 等私有实现。

## 分层与接口

- Controller 只处理 HTTP 参数、当前用户、DTO、Service 调用和响应，不查询数据库或承载复杂规则。
- Service 负责业务规则、权限前置判断、转换、事务编排和异常；不同职责分属合适服务。Entity 只表达数据库结构、约束、索引和关联。
- 请求模型、响应模型和 Entity 分离；不得直接返回 Entity。使用 Mapper/Service 输出安全响应，排除密码、Token 和内部字段。
- Body、Query 和 Param 使用 Zod schema，并经 Nest `StandardSchemaValidationPipe` 与 `@Body({ schema })`、`@Query({ schema })`、`@Param({ schema })` 绑定。对象请求默认用 `z.strictObject`；类型从 schema 派生，必要时区分 `z.input` / `z.output`。不得在 Controller/Service 重复校验，也不得引入 `class-validator`、`class-transformer` 或平行校验管道。Swagger DTO 只提供文档元数据。
- 数据访问使用 MikroORM Repository 或 EntityManager，不在 Controller 操作数据库。多表写入、状态切换和一致性操作使用事务。
- 认证授权复用现有 JWT Guard、`@Public()`、`@CurrentUser()`、`RolesGuard` 和 `@Roles()`。新增 Guard、Decorator、Pipe 前确认现有实现不能满足需求。
- 使用 Nest 标准异常；错误不得泄露凭据、数据库连接信息或第三方密钥。跨模块通用基础设施可放 `src/common/`，业务组件留在所属模块。
- API 构建、开发监听、MikroORM CLI 和 TypeScript 测试统一使用 SWC；`nest build` 的类型检查仍开启，避免快速转译掩盖类型错误。
- 配置通过 `ConfigModule` 和环境变量管理，校验类型和值；密钥不入源码，新增配置同步更新 `.env.example`。

## 契约、迁移与测试

- 修改资源、字段、索引、关系或 API 行为前，更新 `docs/contracts/<resource>-crud-contract.md`，记录校验、权限、响应、错误、迁移和验收。同步更新 Swagger 和相关验收文档。
- 影响数据结构、授权、兼容性或 API 行为的歧义先记为“待确认”；未确认前不改 Entity、校验/授权组件或迁移。
- Entity 变化必须创建并审查 Migration，核对 SQL、索引、外键、删除顺序和历史数据兼容性，并验证升级、回滚及再次升级。
- 新增模块测试覆盖 Service 规则、Zod 合法/非法边界和未知字段、转换/默认值、权限与越权、资源不存在、唯一冲突及关键状态迁移；测试放在所属模块 `spec/`。
- API 提交前执行 `pnpm format:check`、API `typecheck`、API `test`、API `build` 和 `pnpm check`；按需阅读 [`validation.md`](validation.md) 确认隔离库与门控。

API 使用原生 ESM；TypeScript 相对导入保留 `.js` 后缀。

## 运行失败日志

聊天模型或工具执行失败时，API 通过 Pino 记录 `llm_call_failed` 结构化事件，包含失败阶段、模型名、会话/运行 ID、工具名/调用 ID、错误类型和有效 HTTP 状态码。错误详情仍通过统一异常映射对客户端隐藏。

日志不得记录原始异常消息或堆栈、模型提示词与响应正文、工具参数与结果、认证信息或第三方密钥。排查失败时使用会话/运行 ID 关联内部 trace；trace 的业务字段仍遵守[安全与业务边界](./security-and-business-boundaries.md)中的白名单要求。
