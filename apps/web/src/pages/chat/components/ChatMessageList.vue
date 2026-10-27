<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { Bot } from '@lucide/vue';
import { cn } from '@/lib/utils';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChatMessage } from '@/api/types/chat';

const props = defineProps<{
  isSending: boolean;
  messages: ChatMessage[];
}>();

const messageList = ref<HTMLElement | null>(null);

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
  <ScrollArea class="chat-scroll-area">
    <div ref="messageList" class="flex flex-col gap-6 p-4 sm:p-6">
      <div
        v-for="message in messages"
        :key="message.id"
        :class="
          cn('flex items-end gap-3', message.role === 'user' && 'justify-end')
        "
      >
        <Avatar v-if="message.role === 'assistant'" size="sm">
          <AvatarFallback>
            <Bot aria-hidden="true" data-icon="inline-start" />
          </AvatarFallback>
        </Avatar>
        <div
          :class="
            cn(
              'min-w-0 max-w-[min(78%,38rem)] rounded-xl border px-4 py-3',
              message.role === 'user'
                ? 'bg-secondary text-secondary-foreground'
                : 'bg-background',
            )
          "
        >
          <MarkdownRenderer :markdown="message.content" />
          <p class="mt-2 text-right text-xs text-muted-foreground">
            {{ message.time }}
          </p>
        </div>
        <Avatar v-if="message.role === 'user'" size="sm">
          <AvatarFallback>我</AvatarFallback>
        </Avatar>
      </div>
      <div v-if="isSending" class="flex items-end gap-3" aria-live="polite">
        <Avatar size="sm">
          <AvatarFallback>
            <Bot aria-hidden="true" data-icon="inline-start" />
          </AvatarFallback>
        </Avatar>
        <div
          class="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground"
        >
          正在整理建议…
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
