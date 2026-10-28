<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ChevronRight } from '@lucide/vue';
import { cn } from '@/lib/utils';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChatMessage } from '@/api/types/chat';

const props = defineProps<{
  isSending: boolean;
  messages: ChatMessage[];
  streamDuration: string | null;
}>();

const messageList = ref<HTMLElement | null>(null);

// 首个增量内容到达后，直接展示助手消息，避免思考提示和空消息气泡重复。
const showThinkingIndicator = computed(
  () => props.isSending && props.messages.at(-1)?.role !== 'assistant',
);

async function scrollToLatestMessage() {
  await nextTick();
  messageList.value?.lastElementChild?.scrollIntoView({
    behavior: 'smooth',
    block: 'end',
  });
}

watch(
  () => [props.messages.length, props.isSending],
  () => {
    void scrollToLatestMessage();
  },
  { flush: 'post' },
);
</script>

<template>
  <ScrollArea class="h-full">
    <div
      ref="messageList"
      class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-8"
    >
      <div
        v-for="message in messages"
        :key="message.id"
        :class="
          cn(
            'flex w-full items-end gap-3',
            message.role === 'user' && 'justify-end',
          )
        "
      >
        <div
          :class="
            cn(
              'flex min-w-0 flex-col gap-1',
              message.role === 'assistant'
                ? 'w-full'
                : 'max-w-[min(78%,38rem)] items-end',
            )
          "
        >
          <p
            :class="
              cn(
                'px-1 text-xs text-muted-foreground',
                message.role === 'user' ? 'text-right' : 'text-left',
              )
            "
          >
            {{ message.time }}
          </p>
          <p
            v-if="message.role === 'assistant' && message.duration"
            class="flex items-center gap-1 border-b border-border/70 px-1 pb-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {{ message.duration }}
            <ChevronRight aria-hidden="true" />
          </p>
          <div
            :class="
              cn(
                'min-w-0 rounded-xl border px-4 py-3',
                message.role === 'user'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'w-full bg-background',
              )
            "
          >
            <MarkdownRenderer :markdown="message.content" />
          </div>
        </div>
      </div>
      <div
        v-if="showThinkingIndicator"
        class="flex w-full items-end gap-3"
        aria-live="polite"
      >
        <div class="flex w-full flex-col gap-1">
          <p
            v-if="streamDuration"
            class="flex items-center gap-1 border-b border-border/70 px-1 pb-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {{ streamDuration }}
            <ChevronRight aria-hidden="true" />
          </p>
          <div
            class="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground"
          >
            正在整理建议…
          </div>
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
