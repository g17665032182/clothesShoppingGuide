<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type {
  ChatAddressSelectionActionStatus,
  ChatAddressSelectionRequest,
  ChatMessage,
  ChatProductCard,
  ChatTryOnAction,
  ChatTryOnStatus,
} from '@/api/types/chat';
import type { RecommendationFeedbackPayload } from '@/api/types/fashion-recommendation';
import type {
  ChatDynamicForm,
  DynamicFormValues,
} from '@/api/types/chat-dynamic-form';
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
import ChatTryOnDialog from './ChatTryOnDialog.vue';
import ChatTryOnResultAttachment from './ChatTryOnResultAttachment.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2, XCircle } from '@lucide/vue';
import ChatDynamicFormCard from './dynamic-form/ChatDynamicFormCard.vue';

const props = defineProps<{
  message: ChatMessage;
  streamDuration: string | null;
  isSending: boolean;
  conversationId: string | null;
  addressSelectionStatus?: (
    draftId: string,
    draftVersion: number,
  ) => ChatAddressSelectionActionStatus;
  addressSelectionError?: (draftId: string, draftVersion: number) => string;
  dynamicFormSubmitting?: (formId: string) => boolean;
  dynamicFormError?: (formId: string) => string;
  recommendationFeedbackStatus?: (
    targetRef: string,
  ) => 'idle' | 'submitting' | 'accepted' | 'duplicate' | 'disabled' | 'error';
  recommendationFeedbackError?: (targetRef: string) => string;
}>();
const router = useRouter();
const tryOnDialogOpen = ref(false);
const tryOnProduct = ref<ChatProductCard | null>(null);
const emit = defineEmits<{
  (event: 'moreProducts', messageId: string, resultIndex: number): void;
  (event: 'buyProduct', externalId: string): void;
  (event: 'selectAddress', request: ChatAddressSelectionRequest): void;
  (event: 'refreshPurchaseDraft', conversationId: string): void;
  (event: 'tryOn', request: { content: string; action: ChatTryOnAction }): void;
  (event: 'openOrder', orderId: string): void;
  (event: 'cancelCandidateOrder', orderId: string): void;
  (
    event: 'submitDynamicForm',
    form: ChatDynamicForm,
    values: DynamicFormValues,
  ): void;
  (event: 'cancelDynamicForm', form: ChatDynamicForm): void;
  (
    event: 'recommendationFeedback',
    payload: RecommendationFeedbackPayload,
  ): void;
}>();

const isRunning = computed(
  () =>
    props.message.status === 'submitted' ||
    props.message.status === 'streaming',
);
const tryOnStatusLabel = computed(() =>
  props.message.tryOnStatus
    ? describeTryOnStatus(props.message.tryOnStatus)
    : '',
);
const tryOnStatusIsActive = computed(() =>
  ['queued', 'processing'].includes(props.message.tryOnStatus?.status ?? ''),
);
const tryOnStatusIsFailure = computed(() =>
  ['failed', 'timed_out'].includes(props.message.tryOnStatus?.status ?? ''),
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

function describeTryOnStatus(status: ChatTryOnStatus): string {
  if (status.status === 'queued') return '试穿任务已排队';
  if (status.status === 'processing') return '正在生成试穿结果';
  if (status.status === 'timed_out') return '试穿仍在处理中，可稍后查看任务';
  if (status.status !== 'failed') return '';
  const labels: Record<string, string> = {
    ACTIVE_TASK_EXISTS: '已有试穿任务正在处理',
    COLOR_UNAVAILABLE: '当前颜色暂不可试穿',
    CONSENT_REQUIRED: '图像处理说明已更新，请重新确认',
    DAILY_QUOTA_EXCEEDED: '今日试穿次数已用完',
    IMAGE_UNAVAILABLE: '图片处理失败，请更换照片后重试',
    PHOTO_UNAVAILABLE: '所选照片暂不可用，请重新选择',
    PROCESSING_TIMEOUT: '试穿处理超时，请稍后查看任务',
    PRODUCT_NOT_TRYON_SUPPORTED: '当前商品不支持试穿',
    TRY_ON_UNAVAILABLE: '试穿暂时不可用，请稍后重试',
    TRY_ON_WAIT_TIMEOUT: '试穿仍在处理中，可稍后查看任务',
    TRY_ON_DISABLED: '当前环境暂未开放试穿',
  };
  return labels[status.code] ?? '试穿未能完成，请重新选择照片后重试';
}

function openTryOn(product: ChatProductCard) {
  tryOnProduct.value = product;
  tryOnDialogOpen.value = true;
}

function openTryOnTasks() {
  void router.push({ name: 'my-try-ons' });
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
        :disabled="isSending || isRunning"
        :conversation-id="conversationId"
        :assistant-message-id="message.id"
        :recommendation-feedback-status="recommendationFeedbackStatus"
        :recommendation-feedback-error="recommendationFeedbackError"
        :address-selection-status="addressSelectionStatus"
        :address-selection-error="addressSelectionError"
        @buy-product="(externalId) => emit('buyProduct', externalId)"
        @select-address="(request) => emit('selectAddress', request)"
        @refresh-purchase-draft="
          (conversationId) => emit('refreshPurchaseDraft', conversationId)
        "
        @try-on="openTryOn"
        @recommendation-feedback="
          (payload) => emit('recommendationFeedback', payload)
        "
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
        v-if="message.forms.length"
        class="grid min-w-0 gap-3"
        aria-label="需要补充的信息"
      >
        <ChatDynamicFormCard
          v-for="form in message.forms"
          :key="form.formId"
          :form="form"
          :submitting="dynamicFormSubmitting?.(form.formId) ?? false"
          :error-message="dynamicFormError?.(form.formId) ?? ''"
          @submit="(values) => emit('submitDynamicForm', form, values)"
          @cancel="emit('cancelDynamicForm', form)"
        />
      </section>
      <Alert
        v-if="message.tryOnStatus"
        :variant="tryOnStatusIsFailure ? 'destructive' : 'default'"
        role="status"
      >
        <Spinner v-if="tryOnStatusIsActive" />
        <AlertTitle>{{ tryOnStatusLabel }}</AlertTitle>
        <AlertDescription v-if="tryOnStatusIsFailure">
          {{
            message.tryOnStatus.status === 'timed_out'
              ? '任务没有被重复提交，生成仍可在试穿任务中查看。'
              : '检查照片和商品颜色后，可以重新发起试穿。'
          }}
        </AlertDescription>
        <Button
          v-if="message.tryOnStatus.taskId"
          size="sm"
          variant="outline"
          @click="openTryOnTasks"
        >
          查看试穿任务
        </Button>
      </Alert>
      <ChatTryOnResultAttachment
        v-if="message.tryOnResult"
        :result="message.tryOnResult"
      />
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
                class="wrap-break-word text-muted-foreground"
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
        @try-on="openTryOn"
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
  <ChatTryOnDialog
    :open="tryOnDialogOpen"
    :product="tryOnProduct"
    :busy="isRunning"
    @update:open="tryOnDialogOpen = $event"
    @submit="emit('tryOn', $event)"
  />
</template>
