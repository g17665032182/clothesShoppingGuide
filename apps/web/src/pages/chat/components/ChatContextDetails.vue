<script setup lang="ts">
import { computed } from 'vue';
import type { ChatContextUsage } from '@/api/types/chat';
import { Progress } from '@/components/ui/progress';

const props = defineProps<{
  context: ChatContextUsage | null;
  isPrevious: boolean;
}>();

const percentage = computed(() => {
  const context = props.context;
  if (
    context?.usedTokens === null ||
    !context ||
    context.contextWindowTokens <= 0
  )
    return null;
  return (context.usedTokens / context.contextWindowTokens) * 100;
});
const rows = computed(() => [
  { label: '输入', value: props.context?.inputTokens ?? null },
  { label: '输出', value: props.context?.outputTokens ?? null },
  { label: '合计', value: props.context?.usedTokens ?? null },
  { label: '上下文窗口', value: props.context?.contextWindowTokens ?? null },
]);

function formatTokens(value: number | null): string {
  return value === null ? '未知' : value.toLocaleString('zh-CN');
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <div class="flex items-center justify-between gap-3">
      <span class="font-medium">上下文用量</span>
      <span class="text-muted-foreground">{{
        percentage === null ? '暂无数据' : `${Math.round(percentage)}%`
      }}</span>
    </div>
    <p class="text-xs text-muted-foreground">
      {{ isPrevious ? '上一轮已完成回复' : '最近一次已完成回复' }}
    </p>
    <Progress
      v-if="percentage !== null"
      :model-value="Math.min(100, Math.max(0, percentage))"
      :aria-label="`上下文已使用 ${Math.round(percentage)}%`"
    />
    <dl class="flex flex-col gap-1.5">
      <div
        v-for="row in rows"
        :key="row.label"
        class="flex justify-between gap-3"
      >
        <dt class="text-muted-foreground">{{ row.label }}</dt>
        <dd class="text-right tabular-nums">{{ formatTokens(row.value) }}</dd>
      </div>
    </dl>
  </div>
</template>
