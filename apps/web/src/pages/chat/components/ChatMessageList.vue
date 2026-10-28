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
const sessionGapMs = 5 * 60 * 1000;

// 首个增量内容到达后，直接展示助手消息，避免思考提示和空消息气泡重复。
const showThinkingIndicator = computed(
  () => props.isSending && props.messages.at(-1)?.role !== 'assistant',
);

const messagesWithSessionTime = computed(() => {
  let lastAssistantAt: number | null = null;

  return props.messages.map((message) => {
    const currentTime = Date.parse(message.createdAt);
    const shouldShow =
      message.role === 'user' &&
      (lastAssistantAt === null ||
        (Number.isFinite(currentTime) &&
          currentTime - lastAssistantAt > sessionGapMs));

    // 用 AI 回复时间作为基准，衡量用户隔了多久再次发起对话。
    if (message.role === 'assistant' && Number.isFinite(currentTime)) {
      lastAssistantAt = currentTime;
    }

    return {
      ...message,
      showSessionTime: shouldShow,
    };
  });
});

function formatSessionTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
      class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-0 py-5 sm:py-6"
    >
      <div v-for="message in messagesWithSessionTime" :key="message.id">
        <div
          v-if="message.showSessionTime"
          class="flex justify-center py-1 text-xs text-muted-foreground"
          role="separator"
        >
          <time
            class="rounded-full bg-muted/70 px-2.5 py-1"
            :datetime="message.createdAt"
          >
            {{ formatSessionTime(message.createdAt) }}
          </time>
        </div>
        <div
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
              v-if="message.role === 'assistant' && message.duration"
              class="flex items-center gap-1 px-1 text-xs text-muted-foreground"
              aria-live="polite"
            >
              {{ message.duration }}
              <ChevronRight aria-hidden="true" />
            </p>
            <div
              :class="
                cn(
                  'min-w-0 px-1 py-1',
                  message.role === 'user'
                    ? 'rounded-xl bg-muted px-4 py-3 text-foreground'
                    : 'w-full text-foreground',
                )
              "
            >
              <MarkdownRenderer :markdown="message.content" />
            </div>
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
            class="flex items-center gap-1 px-1 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {{ streamDuration }}
            <ChevronRight aria-hidden="true" />
          </p>
          <div class="px-1 py-1 text-sm text-muted-foreground">
            正在整理建议…
          </div>
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
