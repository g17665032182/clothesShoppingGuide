# Web 前端

Vue 3 + Vite + TypeScript 应用，UI 基础使用 shadcn-vue。

```bash
pnpm --filter @clothes-shopping-guide/web dev
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
```

shadcn-vue 组件源码放在 `src/components/ui/`，通过项目根目录运行 CLI 添加：

```bash
pnpm dlx shadcn-vue@latest add button --cwd apps/web
```
