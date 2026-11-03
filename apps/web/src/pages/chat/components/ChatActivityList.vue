<script setup lang="ts">
import { computed, ref } from 'vue';
import { CircleCheck, CirclePause, CircleX, LoaderCircle } from '@lucide/vue';
import type { ChatActivity, ChatTurnStatus } from '@/api/types/chat';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import ChatToolActivity from './ChatToolActivity.vue';
import ChatReasoningActivity from './ChatReasoningActivity.vue';

const props = defineProps<{
  activities: ChatActivity[];
  answering: boolean;
  status: ChatTurnStatus;
}>();

// 未手动选择时随真实运行状态展开，手动选择后不再被流式更新覆盖。
const open = ref<boolean>();
const active = computed(
  () => props.status === 'submitted' || props.status === 'streaming',
);
const failed = computed(() =>
  props.activities.some(
    (activity) => activity.type === 'tool' && activity.status === 'error',
  ),
);
const interrupted = computed(() =>
  props.activities.some(
    (activity) =>
      activity.type === 'tool' &&
      (activity.status === 'interrupted' ||
        (activity.status === 'running' && !active.value)),
  ),
);
const running = computed(
  () =>
    active.value &&
    (!props.answering ||
      props.activities.some(
        (activity) => activity.type === 'tool' && activity.status === 'running',
      )),
);
const summary = computed(() => {
  const count = props.activities.length;
  if (running.value) return `正在执行 · ${count} 个步骤`;
  if (failed.value) return `执行失败 · ${count} 个步骤`;
  if (interrupted.value) return `执行已中断 · ${count} 个步骤`;
  return `已执行 ${count} 个步骤`;
});
</script>

<template>
  <Trace class="min-w-0 max-w-full">
    <TraceCollapsible
      :open="open ?? running"
      :unmount-on-hide="false"
      @update:open="open = $event"
    >
      <TraceCollapsibleTrigger>
        <TraceLine
          :status="
            running
              ? 'running'
              : failed
                ? 'error'
                : interrupted
                  ? 'pending'
                  : undefined
          "
        >
          <TraceIcon>
            <LoaderCircle v-if="running" class="motion-safe:animate-spin" />
            <CircleX v-else-if="failed" />
            <CirclePause v-else-if="interrupted" />
            <CircleCheck v-else />
          </TraceIcon>
          <TraceTitle>{{ summary }}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          <template v-for="activity in activities" :key="activity.id">
            <ChatToolActivity
              v-if="activity.type === 'tool'"
              :activity="activity"
              :turn-status="status"
            />
            <ChatReasoningActivity
              v-else
              :summary="activity.summary"
              :running="running"
            />
          </template>
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>
</template>
