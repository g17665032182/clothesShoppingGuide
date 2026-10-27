<script setup lang="ts">
import {
  VueMarkdown,
  type CustomAttrs,
  type PluggableList,
} from '@crazydos/vue-markdown';
import 'highlight.js/styles/github.css';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

interface Props {
  /** 要展示的 Markdown 内容。 */
  markdown: string;
  /** 是否启用 HTML 安全过滤，默认开启。 */
  sanitize?: boolean;
}

withDefaults(defineProps<Props>(), {
  sanitize: true,
});

// 固定插件实例，避免组件每次更新时重复创建 Unified 处理链。
const remarkPlugins: PluggableList = [remarkGfm];
const rehypePlugins: PluggableList = [
  // 仅处理带语言标识的代码块，避免对普通文本进行错误的语言猜测。
  [rehypeHighlight, { detect: false }],
];

const customAttrs: CustomAttrs = {
  a: {
    rel: 'noopener noreferrer',
    target: '_blank',
  },
  img: {
    decoding: 'async',
    loading: 'lazy',
  },
};
</script>

<template>
  <article class="markdown-renderer">
    <VueMarkdown
      :markdown="markdown"
      :remark-plugins="remarkPlugins"
      :rehype-plugins="rehypePlugins"
      :custom-attrs="customAttrs"
      :sanitize="sanitize"
    />
  </article>
</template>

<style scoped>
.markdown-renderer {
  min-width: 0;
  color: #252923;
  font-size: 15px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.markdown-renderer :deep(> :first-child) {
  margin-top: 0;
}

.markdown-renderer :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown-renderer :deep(h1),
.markdown-renderer :deep(h2),
.markdown-renderer :deep(h3),
.markdown-renderer :deep(h4),
.markdown-renderer :deep(h5),
.markdown-renderer :deep(h6) {
  margin: 1.75em 0 0.65em;
  color: #252923;
  font-weight: 700;
  line-height: 1.25;
}

.markdown-renderer :deep(h1) {
  font-size: 1.8rem;
}

.markdown-renderer :deep(h2) {
  padding-bottom: 0.35rem;
  border-bottom: 1px solid #e3e5df;
  font-size: 1.45rem;
}

.markdown-renderer :deep(h3) {
  font-size: 1.2rem;
}

.markdown-renderer :deep(p),
.markdown-renderer :deep(ul),
.markdown-renderer :deep(ol),
.markdown-renderer :deep(blockquote),
.markdown-renderer :deep(pre),
.markdown-renderer :deep(table) {
  margin: 0 0 1rem;
}

.markdown-renderer :deep(ul),
.markdown-renderer :deep(ol) {
  padding-left: 1.5rem;
}

.markdown-renderer :deep(li + li) {
  margin-top: 0.25rem;
}

.markdown-renderer :deep(a) {
  color: #315c48;
  text-decoration: underline;
  text-decoration-color: #a9bcae;
  text-underline-offset: 0.15em;
}

.markdown-renderer :deep(a:hover) {
  color: #244936;
  text-decoration-color: currentColor;
}

.markdown-renderer :deep(blockquote) {
  padding: 0.15rem 1rem;
  border-left: 3px solid #9ab19f;
  color: #626a63;
}

.markdown-renderer :deep(blockquote > :last-child) {
  margin-bottom: 0;
}

.markdown-renderer :deep(:not(pre) > code) {
  padding: 0.15em 0.4em;
  border: 1px solid #e1e6df;
  border-radius: 4px;
  background: #f1f4ef;
  color: #315c48;
  font-size: 0.9em;
}

.markdown-renderer :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid #e1e5e0;
  border-radius: 6px;
}

.markdown-renderer :deep(pre code.hljs) {
  min-width: max-content;
  padding: 1rem;
  font-size: 0.875rem;
  line-height: 1.65;
}

.markdown-renderer :deep(hr) {
  margin: 1.75rem 0;
  border: 0;
  border-top: 1px solid #e3e5df;
}

.markdown-renderer :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.markdown-renderer :deep(th),
.markdown-renderer :deep(td) {
  min-width: 8rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid #dfe4de;
  text-align: left;
  vertical-align: top;
}

.markdown-renderer :deep(th) {
  background: #f1f4ef;
  font-weight: 650;
}

.markdown-renderer :deep(.task-list-item) {
  list-style: none;
}

.markdown-renderer :deep(.task-list-item input) {
  margin: 0 0.45rem 0 0;
  accent-color: #315c48;
}
</style>
