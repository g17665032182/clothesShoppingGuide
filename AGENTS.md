# 开发约定

1. 开发功能前先查找本地依赖并阅读文档，优先复用已有能力；本地依赖无法解决时，再查找合适的开源库，最后才自行实现。
2. 模块化开发，保持高内聚、低耦合。应用放在 `apps/`，共享模块放在 `packages/`。
3. 新增代码中的必要注释使用中文，解释设计意图和复杂逻辑，避免无意义的逐行注释。
4. 统一使用 pnpm；仓库内部依赖使用 `workspace:*`，禁止依赖其他模块的私有实现。
5. 提交前运行 `pnpm check`。新增业务逻辑时补充相应测试，并在所属包中提供 `test` 脚本。
6. 开发采用 Agent Team 协作模式：较大功能由主代理负责需求边界、任务拆分、集成和最终验证，团队代理承担边界清晰且可独立完成的设计、实现或审查任务；简单、紧急或强耦合的小改动由主代理直接完成。
7. 派发任务时明确目标文件/模块、依赖、不可变更边界和验收标准。优先按模块或文件划分所有权，避免多个代理同时修改同一文件；共享数据库、端口、构建目录等可变资源的操作必须串行，隔离条件不明确时不得并行执行。
8. 主代理必须审阅团队代理的改动和验证证据，负责冲突处理、跨模块集成及整体测试；代理报告或局部检查不能替代主代理对最终结果的验证。保留各代理发现的失败、跳过和未执行项，不将任务已派发描述为已完成。

## 项目导航与文档维护

1. 本仓库为服装购物助手 pnpm Monorepo：`apps/web` 使用 Vue 3、Vite、shadcn-vue；`apps/api` 使用 NestJS、MikroORM、PostgreSQL 和 LangGraph。实际依赖和可执行命令以各包 `package.json` 为准。
2. 开始工作前阅读相关契约、实施记录与当前源码，并检查 `git status`。保留已有修改、本地环境配置和私有图片；不得把历史设计或实施计划直接当作已完成功能。
3. 主要业务模块为商品目录、聊天记录与模型工具、结构化偏好与长期记忆、收货地址、订单、聊天购买、聊天取消订单和虚拟试穿。跨模块调用优先复用公开入口或 Port，不直接读取其他模块的 Entity/Repository。
4. 较大业务变更沿用需求、设计/契约、技术方案、实施方案、实现和验证流程；使用本仓库 `module-development-workflow` 技能。按用户已确认的阶段推进，不重复询问已确定事项；影响已批准业务边界的变更先更新相关文档。
5. `README.md` 维护项目能力、环境、启动配置、常用命令和文档入口；`AGENTS.md` 维护长期有效的开发、架构和验证约定。功能入口、配置、脚本或开发流程发生变化时，同步更新相关文档。
6. 实施文档和测试记录必须区分已实现、已验证、失败、跳过与未执行。报告保留首轮失败及后续修复结果；不要把格式检查、构建或源码审查描述为浏览器流程通过。
7. 后端使用原生 ESM，现有 TypeScript 相对导入保留 `.js` 后缀；不得仅因源码为 `.ts` 就批量替换导入后缀。

## 业务与隐私边界

1. LLM 订单、地址和购买工具的当前用户及会话由服务端认证上下文绑定；工具 schema 不接受模型提供的 `userId`，不能通过提示词约定替代服务端所有权检查。
2. 地址查询工具仅返回地址 ID、默认标记和系统生成的显示标签；完整姓名、手机号、详细地址和用户自定义标签不得进入该工具的模型响应、trace 或 SSE activity。选择地址后由服务端检查归属并写入当前购买草稿；新地址仅在用户显式保存后加入地址簿。
3. 模型可以准备购买草稿、查询本人订单和可取消候选；创建正式订单、支付、取消和确认收货由用户界面显式操作触发。聊天订单卡必须来自服务端校验过的结构化投影，不能从 Markdown 或模型文本构造可执行动作。
4. 取消订单沿用本人、未过期 `pending_payment` 的规则；用户选择订单并在确认弹框确认后调用现有接口。已付款取消、真实退款和退换货不属于当前能力；模拟支付不产生真实扣款。
5. 商品试穿入口以商品目录的当前服务端资格为准：管理员开启、有效服装品类、有效颜色 SKU 和可用图片；无库存不影响试穿，鞋类不支持。无可用 SKU 图或商品级试穿图时，管理员需先上传图片才能开启。创建任务时必须重新校验，不能信任旧卡片状态。
6. 本地私有试穿存储仅限 `NODE_ENV=development` 与 `TRY_ON_STORAGE_DRIVER=local`；不得暴露为静态目录或关闭 TLS 校验。真实人像处理政策未确认前保持真实照片流程关闭，开发验证仅使用已登记的公开/合成图片。
7. 运行时模型上下文、内部 `chat_trace_events` 和公开 `chat_messages` 是不同边界。上下文 Markdown 需由服务端读取装配；不能把文件链接或资源复制当作内容已进入模型。新增工具使用字段白名单投影，不将完整实体、联系方式、密钥、图片 Base64、对象键或签名 URL 写入工具 trace、activity、日志或工具生成的公开投影。用户主动发送的聊天原文仍遵循原有持久化规则。

## 前端开发规范

1. 新增页面统一放在前端应用的 `src/pages/` 目录下；现有 `src/views/` 页面可以在后续迭代中逐步迁移，不要求一次性重构。
2. 每个页面必须使用独立文件夹，并且至少包含：
   - `index.vue`：页面主文件，只负责页面结构、组件组合和基础交互绑定。
   - `page.ts`：页面级状态、事件处理和页面逻辑。
   - `components/`：只供当前页面使用的私有组件。
3. `index.vue` 不直接编写接口请求、复杂数据转换、定时器和大段业务逻辑；这些逻辑应放入 `page.ts`、组合式函数或业务模块中。
4. 页面目录建议使用以下结构：

   ```text
   src/pages/
   └── chat/
       ├── index.vue
       ├── page.ts
       └── components/
           ├── ChatSidebar.vue
           ├── ChatMessageList.vue
           └── ChatComposer.vue
   ```

5. 页面私有组件放在当前页面的 `components/` 中；被两个及以上页面复用的业务组件放在 `src/components/shared/`；基础 UI 组件放在 `src/components/ui/`。
6. shadcn-vue 组件统一维护在 `src/components/ui/`，优先通过 shadcn-vue CLI 添加，不在页面目录中复制基础组件实现。
7. 接口请求统一使用 Axios 并封装在 `src/api/` 中：`src/api/index.ts` 负责 Axios 实例、请求底座和认证重试，`src/api/modules/*.ts` 负责按资源组织接口；页面不得重复拼接 API 地址、直接散落调用 Axios 或处理底层认证细节。
8. 业务模块按领域组织，类型和接口适配器应与页面解耦：

   ```text
   src/api/
   ├── modules/
   │   └── chat.ts
   └── types/
       └── chat.ts

   src/pages/chat/
   ├── mock-data.ts
   └── components/
   ```

9. 页面临时状态放在页面的 `page.ts` 或页面组合式函数中；跨页面共享状态放在 `src/stores/` 或已有的状态模块中，不得通过页面组件相互传递隐式全局状态。
10. 目录使用 kebab-case；Vue 组件使用 PascalCase；组合式函数使用 `useXxx`；Store 使用 `useXxxStore`；路由名称使用 kebab-case。
11. 每个页面必须明确处理加载中、加载失败、空数据、正常展示、提交中和提交失败等状态。
12. 页面组件之间禁止直接引用其他页面的私有组件、私有状态和私有 API 实现；跨模块能力必须通过公开入口使用。
13. 前端不得直接依赖后端 Entity、Controller、数据库模型或后端内部 DTO；接口请求和响应类型统一维护在 `src/api/types/` 中。
14. 页面卸载时必须清理定时器、事件监听器、订阅和未完成的请求；涉及异步请求时优先支持取消或过期响应保护。
15. 页面应满足响应式布局、键盘操作、语义化 HTML 和基础无障碍要求；交互控件优先复用 shadcn-vue 和现有图标库。
16. 新增页面或业务模块应补充测试方案，测试文件可与页面或业务模块就近放置；可执行 `test` 脚本在测试基础设施获准落地时提供。当前执行方式及依赖限制遵循第 30 条，不自行安装测试框架或新增前端测试脚本。
17. 新增代码中的必要注释统一使用中文，重点说明业务规则、状态流转、接口兼容和复杂逻辑，避免逐行翻译代码。
18. 页面组件的输入和输出必须显式声明：

- 使用 `defineProps` 声明组件输入。
- 使用 `defineEmits` 声明组件事件。
- 子组件不得直接修改 Props。
- 优先遵循“父组件传 Props，子组件通过 Emits 通知”的单向数据流。
- Props、Emits 和暴露的方法必须使用 TypeScript 类型。

19. Vue 模板必须遵循以下安全和可维护性约定：

- `v-for` 必须提供稳定且唯一的 `:key`。
- 避免在同一元素上同时使用 `v-if` 和 `v-for`。
- `computed` 只负责同步派生数据，不执行请求、修改状态或其他副作用。
- 禁止无必要使用 `v-html`；使用时必须确保内容来源可信或已完成安全过滤。
- 组件名称使用多单词 PascalCase，避免使用 `User.vue`、`List.vue` 等单词组件名。
- 避免使用不明确的缩写，变量和组件名称优先使用完整单词。

20. 状态管理必须区分作用域：

- 组件临时状态放在组件内部。
- 页面状态放在页面的 `page.ts` 或页面级组合式函数中。
- 跨页面共享状态放在 `src/stores/` 中。
- 新增全局状态优先使用 Pinia；引入前必须先查阅本地依赖和官方文档。
- 不得将弹窗开关、表单草稿等页面局部状态放入全局 Store。
- 现有 `src/lib/auth.ts` 等状态模块暂时保留，新增共享状态不得继续扩展为无边界的全局单例。

21. 前端代码检查应使用 ESLint 和 Vue 规则：

- 优先采用 `eslint-plugin-vue` 的 Vue 3 推荐配置。
- TypeScript 文件使用 `typescript-eslint` 规则。
- ESLint 与 Prettier 的职责分离，禁止用 ESLint 承担代码格式化。
- 新增前端包应提供 `lint` 和 `lint:fix` 脚本；当前未安装依赖时暂不自行实现替代检查器。

22. 路由必须遵循以下约定：

- 页面组件优先使用懒加载：`component: () => import('@/pages/chat/index.vue')`。
- 登录、角色和游客访问统一通过路由 `meta` 与全局 Guard 处理。
- 页面中不得重复实现相同的鉴权跳转逻辑。
- 路由名称保持唯一并使用 kebab-case。
- 路由参数进入业务逻辑前必须完成类型和合法性校验。

23. 以下属于本项目架构约定，不代表 Vue 官方强制规范：

- 页面必须使用独立目录。
- 页面主文件必须命名为 `index.vue`。
- 页面必须包含 `page.ts`。
- 页面私有组件必须放在页面目录的 `components/` 中。
- API 适配器统一放在 `src/api/modules/`，请求底座统一放在 `src/api/index.ts`。
- API 请求和响应类型统一放在 `src/api/types/`，不得重复定义同一接口类型。
- 页面专属的模拟数据、页面组合式逻辑和页面状态放在对应的 `src/pages/<page>/` 目录中。
  后续调整这些约定时，应同步更新本文件和相关目录文档。

24. Vue 单文件组件统一使用 `<script setup lang="ts">`；组件逻辑、模板和样式应保持在同一组件边界内，跨组件复用逻辑使用 composable，不通过复制代码实现复用。
25. 组件双向绑定必须遵循 Vue 的 `v-model` 约定：

- 新组件优先使用 `modelValue` 和 `update:modelValue`。
- 多个双向绑定使用明确的命名参数。
- 不得通过修改 Props 实现双向绑定。

26. 组件暴露给父组件的方法必须保持最小化；只有确实属于组件公共能力的操作才使用 `defineExpose`，普通交互优先通过 Props 和 Emits 完成。
27. `watch` 只用于监听外部变化并执行必要的副作用；可以通过 `computed` 得到的派生值不得使用 `watch` 和额外的响应式变量保存。
28. 异步副作用必须具备生命周期保护：

- 组件卸载时清理定时器、事件监听器和订阅。
- 请求需要支持取消时使用 `AbortController`。
- 只处理当前请求对应的响应，避免旧请求覆盖新状态。
- 提交按钮、分页和搜索操作必须防止重复请求。

29. 页面接口状态统一使用可区分的状态模型，至少覆盖 `idle`、`loading`、`success`、`empty` 和 `error`；不得仅通过一个布尔值表达所有异步状态。
30. 前端测试规范先记录为项目约定，测试基础设施后续再落地：

- 单元测试优先使用 Vitest。
- 组件测试优先使用 Vue Test Utils。
- 组合式函数、Store、API 适配器和关键业务组件应具备单元测试。
- 页面测试至少覆盖加载、空数据、失败、提交中、提交成功和权限跳转。
- 关键用户流程再使用 Playwright 做浏览器级验证。
- 测试不得依赖真实生产服务、真实第三方密钥或不可控的外部网络。
- 测试数据、请求 Mock 和测试工具应与业务模块边界保持一致。
  当前暂不安装 Vitest、Vue Test Utils 或 Playwright，也不新增前端测试脚本。

31. 前端性能约定：

- 页面路由优先懒加载。
- 大型列表必须考虑分页、虚拟滚动或增量加载。
- 不在模板中重复执行昂贵计算。
- 图片、Markdown、代码高亮和大型第三方模块按实际需要加载。
- 不为未经测量的性能问题添加复杂缓存或过度抽象。

32. 操作成功、失败及请求错误反馈统一使用 shadcn-vue Sonner（`vue-sonner`）Toast；全局仅挂载一个 Toaster。错误监听复用 `useErrorToast`，不得在 Axios 拦截器重复提示，也不得为取消或过期响应弹出提示。加载失败、版本冲突及结果未知保留必要的页面状态和重试入口，字段校验保留无障碍标记；避免同一错误同时通过 Toast 和页面横幅重复展示。成功提示只在接口确认成功后触发。

## 后端开发规范

1. 后端业务代码统一放在 `apps/api/src/`，每个业务能力使用独立模块，例如 `users/`、`auth/`、`chat-records/` 和 `llm/`。
2. 业务模块必须保持高内聚、低耦合。模块内部维护自己的 Controller、Service、Entity、DTO、测试和辅助组件，禁止跨模块引用私有实现。
3. 业务模块根目录应保持精简，只放模块入口及少量必要的根级文件。Controller、Service、Entity、DTO 和测试分别放入所属业务模块自己的职责目录；禁止建立跨业务模块共享的全局 `entity/` 或 `spec/` 目录：
   - `controller/*.controller.ts`
   - `service/*.service.ts`
   - `entity/*.entity.ts`
   - `dto/*.dto.ts`
   - `spec/*.spec.ts`
4. 业务子能力有多个紧密协作文件时，可使用表达业务意图的子目录，例如 `context/`、`history/`、`trace/`；不要为单个文件机械创建目录，也不要把不同职责都塞进一个 Service。拆分以提升职责清晰度和内聚性为准，不以目录数量为目标。
5. 同类通用辅助组件按职责放入所属业务模块子目录，目录使用单数命名：
   - `dto/*.dto.ts`
   - `guard/*.guard.ts`
   - `decorator/*.decorator.ts`
   - `pipe/*.pipe.ts`
   - `interceptor/*.interceptor.ts`
   - `filter/*.filter.ts`
   - `middleware/*.middleware.ts`
6. `Controller` 只负责 HTTP 层工作，包括接收参数、使用 DTO、读取当前用户、调用 Service 和返回响应，不得编写数据库查询或复杂业务逻辑。
7. `Service` 负责业务规则、权限前置判断、数据转换、事务编排和业务异常；不同业务职责应拆分到合适的服务或能力目录，不得为了减少文件数量而堆进单个 Service。
8. `Entity` 只表达数据库结构、字段约束、索引和关联关系，不在 Entity 中编写业务流程。
9. 所有后端 API 的 Body、Query 和路由参数校验统一使用 Zod schema，并通过 Nest `StandardSchemaValidationPipe` 与 `@Body({ schema })`、`@Query({ schema })`、`@Param({ schema })` 绑定；不得在 Controller 或 Service 中重复手动校验。为创建、更新、查询和管理员操作分别定义请求 schema；类型从 schema 派生（优先 `z.infer`，输入与转换后类型不同时分别使用 `z.input` / `z.output`）。对象请求默认使用 `z.strictObject` 拒绝未声明字段，转换、默认值、可空性和边界规则须与 API 契约一致。保留 Nest Swagger DTO 作为文档元数据，不把它当运行时校验来源；不得新增 `class-validator` / `class-transformer` 或另建重复校验管道。
10. 请求模型、响应模型和数据库 Entity 必须分离。禁止直接返回 Entity；Service 或 Mapper 必须转换为安全的响应对象，密码、密码哈希、Refresh Token 和内部字段不得返回。
11. 所有数据库访问统一使用 MikroORM Repository 或 EntityManager，不得在 Controller 中直接操作数据库。
12. 涉及多表写入、状态切换或一致性要求的操作必须使用事务，例如聊天记录保存和 Refresh Token 轮换。
13. 新增或修改资源、字段、索引、关联或 API 行为前，必须先创建并更新 `docs/contracts/<resource>-crud-contract.md`，记录字段、校验、权限、响应、错误、迁移和验收约定。
14. 契约中影响数据结构、授权、兼容性或 API 行为的歧义必须先标记为“待确认”。未确认前，不得创建或修改 Entity、DTO、Guard、Decorator、Pipe 或数据库迁移。
15. Entity 发生变化时必须创建并审查 Migration，检查 SQL、索引、外键和历史数据兼容性，并执行迁移验证。
16. 禁止为了验证普通功能随意执行 `migration:fresh`；该命令只能用于明确可销毁的本地或 CI 数据库。
17. 认证和授权统一复用现有 JWT Guard、`@Public()`、`@CurrentUser()`、`RolesGuard` 和 `@Roles()`。新增 Guard、Decorator 或 Pipe 前，必须确认现有实现无法复用。
18. 异常使用 NestJS 标准异常类型，例如 `BadRequestException`、`UnauthorizedException`、`ForbiddenException`、`NotFoundException`、`ConflictException` 和 `ServiceUnavailableException`。错误信息不得泄露密码、Token、数据库连接信息或第三方密钥。
19. `src/common/` 只允许存放跨模块基础设施，例如日志、全局过滤器、通用拦截器和通用工具。业务专属的 Guard、Decorator、DTO、Pipe 和 Service 必须保留在所属业务模块中。
20. 配置统一通过 `ConfigModule` 和环境变量管理。密钥不得写入源码；新增配置必须同步更新 `.env.example`；生产环境必须替换默认密钥和密码；配置值必须进行类型转换和合法性校验。
21. 新增 API 必须同步更新业务契约、Swagger 装饰器、错误行为、认证与权限说明以及验收清单。
22. 每个新增业务模块至少补充 Service 业务规则、Zod schema 与 Nest 参数校验（合法/非法边界、未知字段、默认值或转换及 400 错误行为）、权限和越权、资源不存在、唯一约束冲突以及关键状态转换测试；测试放在所属业务模块的 `spec/` 中。
23. 后端提交前至少执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
```

24. 新增代码中的必要注释统一使用中文，重点解释业务规则、事务边界、兼容性处理和复杂逻辑，避免逐行翻译代码。

## 环境与验证约定

1. 日常启动使用 `pnpm dev:db` 和 `pnpm dev`。API、ORM CLI 和 Seeder 共用环境加载器，优先级为进程环境变量 > `apps/api/.env.dev` > `apps/api/.env`；排查配置时先核对来源，禁止打印真实密钥或完整环境文件。
2. 开发环境显式设置 `NODE_ENV=development`，登录验证码关闭；测试和生产环境启用验证码。不得为了测试便利修改生产验证码规则。
3. 保留数据的数据库使用 `pnpm --filter @clothes-shopping-guide/api migration:up`。`migration:fresh` 内置 `--drop-db --seed`，只用于明确可销毁的数据库；默认 Seeder 只创建管理员，测试商品需单独运行 `catalog:seed:test`。
4. 全量验证入口见 `docs/testing/project-full-validation-plan.md`。`pnpm check` 仅包括格式检查、类型检查与构建，不包含 API 测试；API 测试必须单独运行。Web 当前没有项目内单元/组件或浏览器测试脚本，不把 typecheck/build 当作交互验收。
5. PostgreSQL、迁移和数据库 HTTP 测试使用具名可销毁数据库，不能把默认开发库作为夹具。执行前从测试源码核对 `RUN_*` 门控、实际消费的库名变量、派生库名及初始化/清理逻辑；未设置门控而 skipped 的用例记为未验证。
6. 无共享可变资源的只读检查和无数据库测试可并行；同一数据库/容器内的初始化、迁移、清理及集成测试串行执行。使用子代理并行验证时，必须先确认数据库、端口和文件所有权互相隔离；共享构建目录的检查避免同时运行。
7. 迁移验证除升级外，应按契约覆盖历史数据保留及回滚后再次升级；有反向外键或循环依赖时审查 down 删除顺序。测试断言应核对实际迁移集合/顺序，避免仅以固定数量代替兼容性验证。
8. 聊天集成测试替身需遵守生产调用契约：动态工具经 graph factory 装配，最终回复与有效模型 trace 关联。多轮数据库测试应模拟请求级 EntityManager 边界，不能通过放宽业务断言掩盖夹具错误。
9. 验证报告记录命令、通过/失败/跳过数量、隔离库和清理结果，并单独列出已认证浏览器流程、移动端和真实供应商验证缺口。测试结束只清理本轮创建的容器、数据库、快照和进程，保留用户已有环境。
