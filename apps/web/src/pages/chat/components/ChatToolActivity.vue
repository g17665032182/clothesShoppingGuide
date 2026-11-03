<script setup lang="ts">
import { computed, ref } from 'vue';
import { CircleCheck, CirclePause, CircleX, LoaderCircle } from '@lucide/vue';
import type { ChatActivity, ChatTurnStatus } from '@/api/types/chat';
import { CodeBlock, CodeBlockContent } from '@/components/ui/code-block';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';

const props = defineProps<{
  activity: Extract<ChatActivity, { type: 'tool' }>;
  turnStatus: ChatTurnStatus;
}>();

const open = ref<boolean>();
const status = computed(() =>
  props.activity.status === 'running' &&
  props.turnStatus !== 'submitted' &&
  props.turnStatus !== 'streaming'
    ? 'interrupted'
    : props.activity.status,
);
const title = computed(() => {
  const labels = {
    running: '正在执行',
    success: '已完成',
    error: '执行失败',
    interrupted: '执行已中断',
  };
  return `${labels[status.value]}：${props.activity.toolName}`;
});
const input = computed(() =>
  props.activity.input === null
    ? null
    : JSON.stringify(props.activity.input, null, 2),
);
const hasDetails = computed(
  () => input.value !== null || props.activity.output !== null,
);
</script>

<template>
  <TraceCollapsible
    :open="open ?? status === 'running'"
    :unmount-on-hide="false"
    @update:open="open = $event"
  >
    <TraceCollapsibleTrigger v-if="hasDetails">
      <TraceLine
        :status="
          status === 'running'
            ? 'running'
            : status === 'error'
              ? 'error'
              : status === 'interrupted'
                ? 'pending'
                : undefined
        "
      >
        <TraceIcon>
          <LoaderCircle
            v-if="status === 'running'"
            class="motion-safe:animate-spin"
          />
          <CircleX v-else-if="status === 'error'" />
          <CirclePause v-else-if="status === 'interrupted'" />
          <CircleCheck v-else />
        </TraceIcon>
        <TraceTitle>{{ title }}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceLine
      v-else
      :status="
        status === 'running'
          ? 'running'
          : status === 'error'
            ? 'error'
            : status === 'interrupted'
              ? 'pending'
              : undefined
      "
    >
      <TraceIcon>
        <LoaderCircle
          v-if="status === 'running'"
          class="motion-safe:animate-spin"
        />
        <CircleX v-else-if="status === 'error'" />
        <CirclePause v-else-if="status === 'interrupted'" />
        <CircleCheck v-else />
      </TraceIcon>
      <TraceTitle>{{ title }}</TraceTitle>
    </TraceLine>
    <TraceCollapsibleContent
      v-if="hasDetails"
      class="flex min-w-0 flex-col gap-2"
    >
      <template v-if="input !== null">
        <p>参数</p>
        <CodeBlock size="sm">
          <CodeBlockContent wrap class="max-h-64">{{ input }}</CodeBlockContent>
        </CodeBlock>
      </template>
      <template v-if="activity.output !== null">
        <p>{{ status === 'error' ? '错误摘要' : '结果' }}</p>
        <CodeBlock
          size="sm"
          :variant="status === 'error' ? 'destructive' : 'default'"
        >
          <CodeBlockContent wrap class="max-h-64">{{
            activity.output
          }}</CodeBlockContent>
        </CodeBlock>
      </template>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</template>
