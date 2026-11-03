<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChartPie } from '@lucide/vue';
import type { ChatContextUsage } from '@/api/types/chat';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { InputGroupButton } from '@/components/ui/input-group';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import ChatContextDetails from './ChatContextDetails.vue';

const props = defineProps<{
  context: ChatContextUsage | null;
  isPrevious: boolean;
}>();

const hoverOpen = ref(false);
const popoverOpen = ref(false);
const allowHover = ref(false);
const label = computed(() => {
  const context = props.context;
  const prefix = props.isPrevious ? '上一轮上下文' : '上下文';
  return !context ||
    context.usedTokens === null ||
    context.contextWindowTokens <= 0
    ? `${prefix} · 暂无数据`
    : `${prefix} ${Math.round((context.usedTokens / context.contextWindowTokens) * 100)}%`;
});

function updateHover(value: boolean) {
  hoverOpen.value = allowHover.value && !popoverOpen.value && value;
}

function updatePopover(value: boolean) {
  // 同一个按钮承载悬停与点击，点击浮层打开时关闭悬停浮层。
  allowHover.value = false;
  hoverOpen.value = false;
  popoverOpen.value = value;
}
</script>

<template>
  <HoverCard
    :open="hoverOpen && !popoverOpen"
    :open-delay="300"
    :close-delay="100"
    @update:open="updateHover"
  >
    <Popover :open="popoverOpen" @update:open="updatePopover">
      <HoverCardTrigger as-child>
        <PopoverTrigger as-child>
          <InputGroupButton
            :aria-label="`${label}，查看详情`"
            size="sm"
            type="button"
            variant="ghost"
            @pointerenter.capture="allowHover = $event.pointerType !== 'touch'"
            @pointerleave.capture="allowHover = false"
            @keydown.esc="
              allowHover = false;
              hoverOpen = false;
            "
          >
            <ChartPie aria-hidden="true" data-icon="inline-start" />
            {{ label }}
          </InputGroupButton>
        </PopoverTrigger>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="top"
        class="w-72 max-w-[calc(100vw-2rem)]"
        @pointerenter.capture="allowHover = $event.pointerType !== 'touch'"
        @pointerleave.capture="allowHover = false"
        @keydown.esc="hoverOpen = false"
      >
        <ChatContextDetails :context="context" :is-previous="isPrevious" />
      </HoverCardContent>
      <PopoverContent
        align="start"
        side="top"
        aria-label="上下文用量详情"
        class="w-72 max-w-[calc(100vw-2rem)]"
      >
        <ChatContextDetails :context="context" :is-previous="isPrevious" />
      </PopoverContent>
    </Popover>
  </HoverCard>
</template>
