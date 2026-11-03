<script setup lang="ts">
import { ref } from 'vue';
import { Brain } from '@lucide/vue';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';

defineProps<{ summary: string; running: boolean }>();
const open = ref<boolean>();
</script>

<template>
  <TraceCollapsible
    :open="open ?? running"
    :unmount-on-hide="false"
    @update:open="open = $event"
  >
    <TraceCollapsibleTrigger>
      <TraceLine :status="running ? 'running' : undefined">
        <TraceIcon><Brain /></TraceIcon>
        <TraceTitle>公开推理摘要</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent
      class="whitespace-pre-wrap [overflow-wrap:anywhere]"
    >
      {{ summary }}
    </TraceCollapsibleContent>
  </TraceCollapsible>
</template>
