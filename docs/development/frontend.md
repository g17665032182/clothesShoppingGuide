# 前端开发约定

适用于 `apps/web`。实现前检查本地依赖和现有页面模式；不自行安装当前尚未批准的测试框架或添加替代测试脚本。

操作结果、错误提示和表单保留的详细规则见[前端操作反馈](./frontend-feedback.md)。

## 页面与模块

- 新页面放在 `src/pages/<kebab-case>/`，至少包含 `index.vue`、`page.ts` 和页面私有 `components/`。主文件负责结构、组件组合和基础交互绑定；请求、复杂转换、定时器和页面逻辑放在 `page.ts`、composable 或业务模块。
- 页面私有组件留在页面目录；两个及以上页面复用的业务组件放在 `src/components/shared/`，基础 UI 放在 `src/components/ui/`。shadcn-vue 组件通过 CLI 添加，不复制基础组件实现。
- 页面状态属于页面；跨页面状态放在 `src/stores/` 或现有共享状态模块。新增全局状态优先考虑 Pinia，先检查本地依赖和文档；弹窗、表单草稿等局部状态不进入全局 Store。
- 组件使用 `<script setup lang="ts">`。输入、事件用带类型的 `defineProps` / `defineEmits` 显式声明；子组件不修改 Props，双向绑定使用 `modelValue` / `update:modelValue` 或命名 `v-model`。仅在确属公共能力时使用 `defineExpose`。
- API 请求统一由 Axios 底座 `src/api/index.ts` 和 `src/api/modules/` 资源适配器承载；请求/响应类型放在 `src/api/types/`。页面不直接散落调用 Axios、拼接 API URL 或处理认证重试；前端不得依赖后端 Entity、Controller 或内部 DTO。
- 路由优先懒加载；登录、角色和游客访问统一由路由 `meta` 与全局 Guard 处理。路由名使用 kebab-case，路由参数进入业务逻辑前校验。

## 行为与可访问性

- 页面明确表达 `idle`、`loading`、`success`、`empty`、`error` 等接口状态，并处理提交中、提交失败和重试。
- 异步请求避免重复提交和过期响应覆盖；需要时使用 `AbortController`，卸载时清理定时器、监听器和订阅。
- 模板 `v-for` 使用稳定唯一 `:key`；避免同元素同时使用 `v-if` 和 `v-for`。`computed` 仅做同步派生；避免不必要的 `v-html`，可信内容必须经过安全处理。
- 满足响应式、键盘操作、语义化 HTML 和基础无障碍要求。变量、目录、组件及状态命名遵循仓库现有 kebab-case / PascalCase / `useXxx` / `useXxxStore` 约定。
- 工具按钮优先使用现有图标库图标并提供可访问名称/必要 Tooltip；选项、模式、开关和数值分别使用菜单、分段控件、Toggle/Checkbox 与输入控件。避免用装饰性文字胶囊代替熟悉控件，不嵌套卡片，也不把业务工具做成营销式落地页。
- 操作结果反馈使用 Sonner Toast，全局仅挂载一个 Toaster；请求错误复用 `useErrorToast`，不在 Axios 拦截器重复提示。取消/过期响应不提示；失败、冲突或结果未知时保留页面状态和重试入口，成功提示只在接口确认成功后触发。
- 页面路由懒加载；大型列表考虑分页或增量加载。不要为未测量的性能问题添加复杂缓存。
- 使用根目录 Oxlint 检查 JavaScript/TypeScript 和 Vue 单文件组件中的 `<script>`，启用 Vue 规则；Vue 模板类型由 `vue-tsc` 检查，格式化交由 Oxfmt。Oxfmt 配置由仓库原 Prettier 配置迁移生成；Oxlint 的 Vue 模板规则覆盖尚不完整，不以 lint 结果替代模板类型检查。`pnpm check` 会执行 lint 和格式检查；修复可运行 `pnpm lint:fix` 或 `pnpm format`，审阅自动修改后再提交。

## 测试

测试基础设施按项目当前批准状态执行：Vitest、Vue Test Utils 和 Playwright 尚未获准安装或接入，不自行新增依赖和前端测试脚本。页面/模块的测试方案仍需记录；Web 类型检查和构建不等同于交互或浏览器验收。
