<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage } from '@/api/types/chat';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import {
  Message,
  MessageContent,
  MessageFooter,
} from '@/components/ui/message';
import { Spinner } from '@/components/ui/spinner';
import ChatActivityList from './ChatActivityList.vue';
import ChatProductResults from './ChatProductResults.vue';
import ChatSources from './ChatSources.vue';

const props = defineProps<{
  message: ChatMessage;
  streamDuration: string | null;
}>();
const emit = defineEmits<{
  (event: 'moreProducts', messageId: string, resultIndex: number): void;
}>();

const isRunning = computed(
  () =>
    props.message.status === 'submitted' ||
    props.message.status === 'streaming',
);

const statusLabel = computed(() => {
  switch (props.message.status) {
    case 'failed':
      return '回复失败';
    case 'interrupted':
      return '生成已停止';
    case 'uncertain':
      return '保存状态待核实';
    default:
      return '';
  }
});
</script>

<template>
  <Message>
    <MessageContent class="gap-3">
      <ChatActivityList
        v-if="message.activities.length"
        :activities="message.activities"
        :answering="Boolean(message.content)"
        :status="message.status"
      />
      <MarkdownRenderer
        v-if="message.content"
        class="max-w-full"
        :markdown="message.content"
      />
      <p
        v-else-if="isRunning && !message.activities.length"
        class="flex items-center gap-2 text-muted-foreground"
        role="status"
      >
        <Spinner aria-hidden="true" />
        正在生成回复
      </p>
      <ChatSources v-if="message.sources.length" :sources="message.sources" />
      <ChatProductResults
        v-if="message.productResults.length"
        :result-sets="message.productResults"
        :disabled="isRunning"
        @more="(resultIndex) => emit('moreProducts', message.id, resultIndex)"
      />
      <MessageFooter
        v-if="statusLabel || message.duration || streamDuration"
        class="gap-2 px-0"
      >
        <span v-if="statusLabel" role="status">{{ statusLabel }}</span>
        <span v-if="message.duration || streamDuration">
          {{ message.duration || streamDuration }}
        </span>
      </MessageFooter>
    </MessageContent>
  </Message>
</template>
