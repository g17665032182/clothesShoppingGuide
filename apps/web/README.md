# Web 前端

Vue 3 + Vite + TypeScript 应用，UI 基础使用 shadcn-vue。

```bash
pnpm --filter @clothes-shopping-guide/web dev
pnpm --filter @clothes-shopping-guide/web typecheck
pnpm --filter @clothes-shopping-guide/web build
```

顶栏显示的 Web 版本号来自本包 `package.json` 的 `version` 字段，当前起始版本为
`0.1.0`。版本递增与发布步骤见[部署手册的 Web 版本规则](../../docs/development/deployment.md#web-版本号与发布)。

## Markdown 展示组件

`src/components/MarkdownRenderer.vue` 已内置 GFM、代码高亮和 HTML 安全过滤：

````vue
<script setup lang="ts">
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';

const markdown = '# 今日穿搭\\n\\n```ts\\nconst season = \"autumn\";\\n```';
</script>

<template>
  <MarkdownRenderer :markdown="markdown" />
</template>
````

默认会过滤不安全 HTML，并为链接添加新窗口打开及安全 `rel` 属性。只有在内容来源可信时，才传入 `:sanitize="false"`。

## API 目录

前端 API 代码统一放在 `src/api/`：

- `src/api/index.ts`：Axios 实例、错误处理、JWT 请求头和 Refresh Token 重试。
- `src/api/modules/*.ts`：按资源组织接口，例如认证和用户接口。
- `src/api/types/*.ts`：接口请求与响应类型。

页面逻辑只通过 API 模块调用接口，不直接使用 Axios 或拼接 API 地址。

示例：

```ts
import { signIn } from '@/api/modules/auth';

const response = await signIn({
  email: 'user@example.com',
  password: 'ChangeMe123!',
});
console.log(response.user, response.accessToken);
```

shadcn-vue 组件源码放在 `src/components/ui/`，通过项目根目录运行 CLI 添加：

```bash
pnpm dlx shadcn-vue@latest add button --cwd apps/web
```

## 基础聊天界面

登录后访问 `/chat` 可以查看基础聊天界面。当前消息发送使用本地状态模拟，
页面结构已经预留消息列表、Markdown 消息渲染和输入提交边界，后续接入聊天接口时
可以替换 `src/pages/chat/page.ts` 中的本地回复逻辑。
