<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  AlertTriangle,
  Eye,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from '@lucide/vue';

import { ApiError } from '@/api';
import {
  clearMemoryDocument,
  getMemoryDocument,
  updateMemoryDocument,
} from '@/api/modules/memories';
import type { MemoryDocument } from '@/api/types/memories';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { auth } from '@/lib/auth';

const document = ref<MemoryDocument | null>(null);
const latest = ref<MemoryDocument | null>(null);
const draft = ref('');
const status = ref<'loading' | 'ready' | 'error'>('loading');
const action = ref<'idle' | 'saving' | 'clearing'>('idle');
const error = ref('');
const conflict = ref(false);
const saved = ref(false);
const preview = ref(false);
const clearOpen = ref(false);
const dirty = computed(
  () => document.value !== null && draft.value !== document.value.content,
);
const bytes = computed(() => new TextEncoder().encode(draft.value).length);
const busy = computed(() => action.value !== 'idle');
let controller: AbortController | null = null;
let version = 0;
let unmounted = false;

async function loadDocument(compare = false) {
  const token = auth.state.token;
  if (!token || busy.value) return;
  controller?.abort();
  const current = new AbortController();
  controller = current;
  const requestVersion = ++version;
  if (!compare) status.value = 'loading';
  error.value = '';
  try {
    const result = await getMemoryDocument(token, current.signal);
    if (unmounted || requestVersion !== version) return;
    if (compare) {
      latest.value = result;
    } else {
      document.value = result;
      draft.value = result.content;
      status.value = 'ready';
    }
  } catch (cause) {
    if (unmounted || current.signal.aborted || requestVersion !== version)
      return;
    if (!compare) status.value = 'error';
    error.value = cause instanceof Error ? cause.message : '读取记忆文档失败。';
  } finally {
    if (requestVersion === version) controller = null;
  }
}

async function save() {
  const token = auth.state.token;
  if (!token || !document.value || busy.value || conflict.value || !dirty.value)
    return;
  if (draft.value === '') {
    clearOpen.value = true;
    return;
  }
  if (bytes.value > 32768) {
    error.value = '文档不能超过 32 KiB。';
    return;
  }
  const content = draft.value;
  action.value = 'saving';
  error.value = '';
  saved.value = false;
  try {
    const result = await updateMemoryDocument(
      token,
      content,
      document.value.revision,
    );
    if (unmounted) return;
    document.value = result;
    saved.value = draft.value === content;
  } catch (cause) {
    if (unmounted) return;
    if (cause instanceof ApiError && cause.status === 409) {
      conflict.value = true;
      latest.value = null;
      error.value = '文档已在其他地方更新。请比对最新版本后决定如何合并。';
    } else {
      error.value =
        cause instanceof Error ? cause.message : '保存记忆文档失败。';
    }
  } finally {
    action.value = 'idle';
  }
  if (conflict.value && !unmounted) await loadDocument(true);
}

function useLatestAsBase() {
  if (!latest.value) return;
  // 保留草稿，仅在用户确认后以远端版本作为下次保存的基线。
  document.value = latest.value;
  latest.value = null;
  conflict.value = false;
  error.value = '';
  saved.value = false;
}

async function clearDocument() {
  const token = auth.state.token;
  if (!token || busy.value) return;
  action.value = 'clearing';
  error.value = '';
  try {
    await clearMemoryDocument(token);
    if (unmounted) return;
    clearOpen.value = false;
    conflict.value = false;
    latest.value = null;
    saved.value = false;
    // DELETE 不返回新 revision，重新读取前不允许以旧版本提交。
    document.value = null;
    draft.value = '';
  } catch (cause) {
    if (unmounted) return;
    error.value = cause instanceof Error ? cause.message : '清空记忆文档失败。';
    return;
  } finally {
    action.value = 'idle';
  }
  await loadDocument();
}

onMounted(() => void loadDocument());
onBeforeUnmount(() => {
  unmounted = true;
  version += 1;
  controller?.abort();
});
</script>

<template>
  <section class="flex flex-col gap-4" aria-label="Markdown 记忆">
    <div
      v-if="status === 'loading'"
      class="flex min-h-48 items-center justify-center gap-2"
      role="status"
    >
      <Spinner /> 正在加载记忆文档
    </div>
    <div
      v-else-if="status === 'error'"
      class="flex flex-col items-center gap-3 py-12"
      role="alert"
    >
      <AlertTriangle class="size-6 text-destructive" />
      <p class="text-sm text-destructive">{{ error }}</p>
      <Button variant="outline" @click="loadDocument()"
        ><RefreshCw data-icon="inline-start" />重试</Button
      >
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-1" role="group" aria-label="文档视图">
          <Button
            :variant="preview ? 'ghost' : 'secondary'"
            :aria-pressed="!preview"
            @click="preview = false"
          >
            <Pencil data-icon="inline-start" />编辑
          </Button>
          <Button
            :variant="preview ? 'secondary' : 'ghost'"
            :aria-pressed="preview"
            @click="preview = true"
          >
            <Eye data-icon="inline-start" />预览
          </Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted-foreground" role="status">
            {{
              action === 'saving'
                ? '保存中'
                : action === 'clearing'
                  ? '清空中'
                  : conflict
                    ? '版本冲突'
                    : dirty
                      ? '未保存'
                      : saved
                        ? '已保存'
                        : '已同步'
            }}
          </span>
          <Button variant="outline" :disabled="busy" @click="clearOpen = true">
            <Trash2 data-icon="inline-start" />清空文档
          </Button>
          <Button :disabled="busy || !dirty || conflict" @click="save">
            <Spinner v-if="action === 'saving'" data-icon="inline-start" />
            <Save v-else data-icon="inline-start" />保存
          </Button>
        </div>
      </div>
      <p v-if="error" class="text-sm text-destructive" role="alert">
        {{ error }}
      </p>
      <div v-if="conflict" class="space-y-3 border-l-2 border-amber-500 pl-4">
        <div v-if="latest" class="space-y-2">
          <h3 class="text-sm font-medium">服务器最新版本</h3>
          <pre
            class="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-muted p-3 text-sm"
            >{{ latest.content || '空文档' }}</pre>
          <Button variant="outline" :disabled="busy" @click="useLatestAsBase"
            >保留草稿并基于最新版本编辑</Button
          >
        </div>
        <Button
          v-else
          variant="outline"
          :disabled="busy"
          @click="loadDocument(true)"
        >
          <RefreshCw data-icon="inline-start" />重新读取最新版本
        </Button>
      </div>
      <textarea
        v-if="!preview"
        v-model="draft"
        aria-label="Markdown 记忆文档"
        class="min-h-80 w-full resize-y rounded-md border bg-background p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="busy"
        placeholder="暂无记忆"
        @input="saved = false"
      />
      <div v-else class="min-h-80 rounded-md border p-4">
        <MarkdownRenderer v-if="draft" :markdown="draft" :sanitize="true" />
        <p v-else class="text-sm text-muted-foreground">暂无记忆</p>
      </div>
      <p class="text-right text-xs text-muted-foreground">
        {{ bytes }} / 32768 字节
      </p>
    </template>
  </section>
  <AlertDialog v-model:open="clearOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>清空 Markdown 记忆？</AlertDialogTitle>
        <AlertDialogDescription
          >文档及未保存的草稿将被清空，结构化偏好和聊天记录不受影响。</AlertDialogDescription
        >
      </AlertDialogHeader>
      <p v-if="error" class="text-sm text-destructive" role="alert">
        {{ error }}
      </p>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="busy">取消</AlertDialogCancel>
        <AlertDialogAction
          :disabled="busy"
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          @click.prevent="clearDocument"
        >
          <Spinner
            v-if="action === 'clearing'"
            data-icon="inline-start"
          />确认清空
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
