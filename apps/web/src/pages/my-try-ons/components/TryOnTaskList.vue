<script setup lang="ts">
import { Download, Eye, RefreshCw, Trash2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import type { TryOnTask } from '@/api/types/try-on';

defineProps<{
  tasks: TryOnTask[];
  resultImageUrls: Record<string, string>;
  busyTaskId?: string | null;
}>();
const emit = defineEmits<{
  (event: 'refresh'): void;
  (event: 'download', task: TryOnTask): void;
  (event: 'delete', task: TryOnTask): void;
  (event: 'read', task: TryOnTask): void;
}>();

const labels: Record<TryOnTask['status'], string> = {
  queued: '排队中',
  processing: '生成中',
  succeeded: '已完成',
  failed: '生成失败',
  deleted: '已删除',
};
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">试穿历史</h2>
      <Button
        variant="outline"
        size="icon"
        aria-label="刷新试穿历史"
        title="刷新试穿历史"
        @click="emit('refresh')"
      >
        <RefreshCw />
      </Button>
    </div>
    <article
      v-for="task in tasks"
      :key="task.id"
      class="grid gap-3 rounded-md border p-3 sm:grid-cols-[96px_minmax(0,1fr)_auto]"
    >
      <img
        v-if="resultImageUrls[task.id]"
        :src="resultImageUrls[task.id]"
        :alt="`${task.product.name} 试穿结果`"
        class="aspect-square w-full rounded-sm object-cover"
      />
      <div
        v-else
        class="flex aspect-square items-center justify-center rounded-sm bg-muted text-xs text-muted-foreground"
      >
        {{ task.status === 'succeeded' ? '结果加载中' : '处理中' }}
      </div>
      <div class="min-w-0 space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-medium">{{ task.product.name }}</h3>
          <span class="text-xs text-muted-foreground">{{
            labels[task.status]
          }}</span>
          <span v-if="task.notification.unread" class="text-xs text-primary"
            >未读</span
          >
        </div>
        <p class="text-sm text-muted-foreground">
          {{ task.product.color }} ·
          {{ new Date(task.createdAt).toLocaleString() }}
        </p>
        <p v-if="task.failureCode" class="text-sm text-destructive">
          {{ task.failureCode }}
        </p>
        <p class="text-xs text-muted-foreground">
          仅供视觉参考，不代表真实尺码或合身程度。
        </p>
      </div>
      <div class="flex items-start gap-1 sm:flex-col">
        <Button
          v-if="task.notification.unread"
          variant="ghost"
          size="icon"
          aria-label="标记已读"
          title="标记已读"
          @click="emit('read', task)"
        >
          <Eye />
        </Button>
        <Button
          v-if="task.status === 'succeeded'"
          variant="ghost"
          size="icon"
          :disabled="busyTaskId === task.id"
          aria-label="下载试穿结果"
          title="下载试穿结果"
          @click="emit('download', task)"
        >
          <Download />
        </Button>
        <Button
          v-if="task.status === 'succeeded'"
          variant="ghost"
          size="icon"
          :disabled="busyTaskId === task.id"
          aria-label="删除试穿结果"
          title="删除试穿结果"
          @click="emit('delete', task)"
        >
          <Trash2 />
        </Button>
      </div>
    </article>
  </div>
</template>
