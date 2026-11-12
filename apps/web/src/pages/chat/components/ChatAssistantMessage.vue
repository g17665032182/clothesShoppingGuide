<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage } from '@/api/types/chat';
import {
  Message,
  MessageContent,
  MessageFooter,
} from '@/components/ui/message';
import { Spinner } from '@/components/ui/spinner';
import ChatActivityList from './ChatActivityList.vue';
import ChatMarkdownRenderer from './ChatMarkdownRenderer.vue';
import ChatProductResults from './ChatProductResults.vue';
import ChatSources from './ChatSources.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CheckCircle2, XCircle } from '@lucide/vue';

const props = defineProps<{
  message: ChatMessage;
  streamDuration: string | null;
}>();
const emit = defineEmits<{
  (event: 'moreProducts', messageId: string, resultIndex: number): void;
  (event: 'buyProduct', externalId: string): void;
  (event: 'openOrder', orderId: string): void;
  (event: 'cancelCandidateOrder', orderId: string): void;
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

function formatOrderDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}
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
      <ChatMarkdownRenderer
        v-if="message.content || message.cards.length"
        :markdown="message.content"
        :cards="message.cards"
        :disabled="isRunning"
        @buy-product="(externalId) => emit('buyProduct', externalId)"
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
      <section
        v-if="message.orderCancellationCandidates.length"
        class="grid min-w-0 gap-3"
        aria-label="可取消订单"
      >
        <Card
          v-for="candidate in message.orderCancellationCandidates"
          :key="candidate.orderId"
          class="rounded-md"
        >
          <CardHeader
            class="flex flex-row flex-wrap items-start justify-between gap-3 pb-3"
          >
            <div class="min-w-0">
              <p class="break-all text-sm font-medium">
                订单号 {{ candidate.orderNo }}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                待付款 · 创建于 {{ formatOrderDate(candidate.createdAt) }}
              </p>
            </div>
            <p class="shrink-0 font-medium">¥{{ candidate.payableAmount }}</p>
          </CardHeader>
          <CardContent class="grid gap-3 pt-0">
            <ul class="grid gap-2 text-sm">
              <li
                v-for="(item, itemIndex) in candidate.items"
                :key="`${candidate.orderId}-${itemIndex}`"
                class="break-words text-muted-foreground"
              >
                {{ item.productName }} · {{ item.color }} · {{ item.size }} ×
                {{ item.quantity }}
              </li>
            </ul>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="min-w-0 flex-1 text-xs text-muted-foreground">
                仅取消未付款订单，不涉及退款。
              </p>
              <span
                v-if="candidate.cancellationResult === 'cancelled'"
                class="inline-flex items-center gap-1 text-sm text-muted-foreground"
                role="status"
              >
                <CheckCircle2 aria-hidden="true" class="size-4" />
                已取消
              </span>
              <Button
                v-else-if="candidate.cancelable"
                size="sm"
                variant="outline"
                @click="emit('cancelCandidateOrder', candidate.orderId)"
              >
                <XCircle aria-hidden="true" data-icon="inline-start" />
                取消订单
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
      <ChatProductResults
        v-if="message.productResults.length"
        :result-sets="message.productResults"
        :disabled="isRunning"
        @more="(resultIndex) => emit('moreProducts', message.id, resultIndex)"
        @buy="(externalId) => emit('buyProduct', externalId)"
      />
      <div
        v-if="message.purchase?.orderId"
        class="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"
      >
        <span class="min-w-0 flex-1 break-all"
          >本次购买已生成订单，可在这里查看并继续处理。</span
        >
        <Button
          size="sm"
          variant="outline"
          @click="emit('openOrder', message.purchase.orderId)"
        >
          查看 / 支付订单
        </Button>
      </div>
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
