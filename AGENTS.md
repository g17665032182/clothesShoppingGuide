# 开发约定

1. 开发功能前先查找本地依赖并阅读文档，优先复用已有能力；本地依赖无法解决时，再查找合适的开源库，最后才自行实现。
2. 模块化开发，保持高内聚、低耦合。应用放在 `apps/`，共享模块放在 `packages/`。
3. 新增代码中的必要注释使用中文，解释设计意图和复杂逻辑，避免无意义的逐行注释。
4. 统一使用 pnpm；仓库内部依赖使用 `workspace:*`，禁止依赖其他模块的私有实现。
5. 提交前运行 `pnpm check`。新增业务逻辑时补充相应测试，并在所属包中提供 `test` 脚本。

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
7. 接口请求统一封装在 `src/api/` 中：`src/api/index.ts` 负责请求底座和认证重试，`src/api/modules/*.ts` 负责按资源组织接口；页面不得重复拼接 API 地址、直接散落调用 `fetch` 或处理底层认证细节。
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
16. 新增页面或业务模块应补充相应测试，测试文件可与页面或业务模块就近放置，并在所属包的 `package.json` 中提供可执行的 `test` 脚本。
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

## 后端开发规范

1. 后端业务代码统一放在 `apps/api/src/`，每个业务能力使用独立模块，例如 `users/`、`auth/`、`chat-records/` 和 `llm/`。
2. 业务模块必须保持高内聚、低耦合。模块内部维护自己的 Controller、Service、Entity、DTO 和辅助组件，禁止跨模块引用私有实现。
3. 业务模块的 Controller、Service、Module 和 Entity 放在模块根目录；同类辅助组件按职责放入模块子目录，目录使用单数命名：
   - `dto/*.dto.ts`
   - `guard/*.guard.ts`
   - `decorator/*.decorator.ts`
   - `pipe/*.pipe.ts`
   - `interceptor/*.interceptor.ts`
   - `filter/*.filter.ts`
   - `middleware/*.middleware.ts`
4. `Controller` 只负责 HTTP 层工作，包括接收参数、使用 DTO、读取当前用户、调用 Service 和返回响应，不得编写数据库查询或复杂业务逻辑。
5. `Service` 负责业务规则、权限前置判断、数据转换、事务编排和业务异常。
6. `Entity` 只表达数据库结构、字段约束、索引和关联关系，不在 Entity 中编写业务流程。
7. 每种请求定义独立 DTO，包括创建、更新、查询和管理员操作 DTO。DTO 必须配合全局 `ValidationPipe` 使用，禁止依赖 Controller 内部手动校验。
8. 请求模型、响应模型和数据库 Entity 必须分离。禁止直接返回 Entity；Service 或 Mapper 必须转换为安全的响应对象，密码、密码哈希、Refresh Token 和内部字段不得返回。
9. 所有数据库访问统一使用 MikroORM Repository 或 EntityManager，不得在 Controller 中直接操作数据库。
10. 涉及多表写入、状态切换或一致性要求的操作必须使用事务，例如聊天记录保存和 Refresh Token 轮换。
11. 新增或修改资源、字段、索引、关联或 API 行为前，必须先创建并更新 `docs/contracts/<resource>-crud-contract.md`，记录字段、校验、权限、响应、错误、迁移和验收约定。
12. 契约中影响数据结构、授权、兼容性或 API 行为的歧义必须先标记为“待确认”。未确认前，不得创建或修改 Entity、DTO、Guard、Decorator、Pipe 或数据库迁移。
13. Entity 发生变化时必须创建并审查 Migration，检查 SQL、索引、外键和历史数据兼容性，并执行迁移验证。
14. 禁止为了验证普通功能随意执行 `migration:fresh`；该命令只能用于明确可销毁的本地或 CI 数据库。
15. 认证和授权统一复用现有 JWT Guard、`@Public()`、`@CurrentUser()`、`RolesGuard` 和 `@Roles()`。新增 Guard、Decorator 或 Pipe 前，必须确认现有实现无法复用。
16. 异常使用 NestJS 标准异常类型，例如 `BadRequestException`、`UnauthorizedException`、`ForbiddenException`、`NotFoundException`、`ConflictException` 和 `ServiceUnavailableException`。错误信息不得泄露密码、Token、数据库连接信息或第三方密钥。
17. `src/common/` 只允许存放跨模块基础设施，例如日志、全局过滤器、通用拦截器和通用工具。业务专属的 Guard、Decorator、DTO、Pipe 和 Service 必须保留在所属业务模块中。
18. 配置统一通过 `ConfigModule` 和环境变量管理。密钥不得写入源码；新增配置必须同步更新 `.env.example`；生产环境必须替换默认密钥和密码；配置值必须进行类型转换和合法性校验。
19. 新增 API 必须同步更新业务契约、Swagger 装饰器、错误行为、认证与权限说明以及验收清单。
20. 每个新增业务模块至少补充 Service 业务规则、DTO 参数校验、权限和越权、资源不存在、唯一约束冲突以及关键状态转换测试。
21. 后端提交前至少执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api build
pnpm check
```

22. 新增代码中的必要注释统一使用中文，重点解释业务规则、事务边界、兼容性处理和复杂逻辑，避免逐行翻译代码。
