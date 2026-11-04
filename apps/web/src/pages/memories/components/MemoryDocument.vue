<script setup lang="ts">
import {
  AlertTriangle,
  Eye,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from '@lucide/vue';

import type { MemoryDocumentState } from '../use-memory-document';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

defineProps<{ state: MemoryDocumentState }>();
const emit = defineEmits<{
  'update:draft': [content: string];
  'update:preview': [preview: boolean];
  'update:clearOpen': [open: boolean];
  load: [compare?: boolean];
  save: [];
  clear: [];
  useLatest: [];
}>();
</script>

<template>
  <section class="flex flex-col gap-4" aria-label="Markdown 记忆">
    <div
      v-if="state.status === 'loading' || state.status === 'idle'"
      class="flex min-h-48 items-center justify-center gap-2"
      role="status"
    >
      <Spinner /> 正在加载记忆文档
    </div>
    <div
      v-else-if="state.status === 'error'"
      class="flex flex-col items-center gap-3 py-12"
      role="alert"
    >
      <AlertTriangle class="size-6 text-destructive" />
      <p class="text-sm text-destructive">{{ state.error }}</p>
      <Button variant="outline" @click="emit('load')">
        <RefreshCw data-icon="inline-start" />重试
      </Button>
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-1" role="group" aria-label="文档视图">
          <Button
            variant="ghost"
            size="icon"
            aria-label="编辑文档"
            title="编辑文档"
            :aria-pressed="!state.preview"
            @click="emit('update:preview', false)"
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="预览文档"
            title="预览文档"
            :aria-pressed="state.preview"
            @click="emit('update:preview', true)"
          >
            <Eye />
          </Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted-foreground" role="status">
            {{
              state.action === 'saving'
                ? '保存中'
                : state.action === 'clearing'
                  ? '清空中'
                  : state.conflict
                    ? '版本冲突'
                    : state.dirty
                      ? '未保存'
                      : state.saved
                        ? '已保存'
                        : '已同步'
            }}
          </span>
          <Button
            variant="outline"
            :disabled="state.busy"
            @click="emit('update:clearOpen', true)"
          >
            <Trash2 data-icon="inline-start" />清空文档
          </Button>
          <Button
            :disabled="state.busy || !state.dirty || state.conflict"
            @click="emit('save')"
          >
            <Spinner
              v-if="state.action === 'saving'"
              data-icon="inline-start"
            />
            <Save v-else data-icon="inline-start" />保存
          </Button>
        </div>
      </div>
      <Alert v-if="state.error" variant="destructive">
        <AlertTriangle />
        <AlertTitle>{{
          state.conflict ? '版本冲突' : '操作未完成'
        }}</AlertTitle>
        <AlertDescription>{{ state.error }}</AlertDescription>
      </Alert>
      <div v-if="state.conflict" class="flex flex-col gap-3 border-l-2 pl-4">
        <div v-if="state.latest" class="flex flex-col gap-2">
          <h3 class="text-sm font-medium">服务器最新版本</h3>
          <pre
            class="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-muted p-3 text-sm"
            >{{ state.latest.content || '空文档' }}</pre>
          <Button
            variant="outline"
            :disabled="state.busy"
            @click="emit('useLatest')"
            >保留草稿并基于最新版本编辑</Button
          >
        </div>
        <Button
          v-else
          variant="outline"
          :disabled="state.busy"
          @click="emit('load', true)"
        >
          <RefreshCw data-icon="inline-start" />重新读取最新版本
        </Button>
      </div>
      <textarea
        v-if="!state.preview"
        :value="state.draft"
        aria-label="Markdown 记忆文档"
        class="min-h-80 w-full resize-y rounded-md border bg-background p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="state.busy"
        placeholder="暂无记忆"
        @input="
          emit('update:draft', ($event.target as HTMLTextAreaElement).value)
        "
      />
      <div v-else class="min-h-80 rounded-md border p-4">
        <MarkdownRenderer
          v-if="state.draft"
          :markdown="state.draft"
          :sanitize="true"
        />
        <p v-else class="text-sm text-muted-foreground">暂无记忆</p>
      </div>
      <p class="text-right text-xs text-muted-foreground">
        {{ state.bytes }} / 32768 字节
      </p>
    </template>
  </section>
  <AlertDialog
    :open="state.clearOpen"
    @update:open="emit('update:clearOpen', $event)"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>清空 Markdown 记忆？</AlertDialogTitle>
        <AlertDialogDescription>
          文档及未保存的草稿将被清空，结构化偏好和聊天记录不受影响。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <p v-if="state.error" class="text-sm text-destructive" role="alert">
        {{ state.error }}
      </p>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="state.busy">取消</AlertDialogCancel>
        <AlertDialogAction
          :disabled="state.busy"
          @click.prevent="emit('clear')"
        >
          <Spinner
            v-if="state.action === 'clearing'"
            data-icon="inline-start"
          />
          确认清空
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
