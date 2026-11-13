<script setup lang="ts">
import { computed } from 'vue';
import { ArrowUp, RotateCw } from '@lucide/vue';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Message, MessageContent } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Spinner } from '@/components/ui/spinner';
import type {
  ChatAddressSelectionActionStatus,
  ChatAddressSelectionRequest,
  ChatMessage,
  ChatTryOnAction,
} from '@/api/types/chat';
import type {
  ChatDynamicForm,
  DynamicFormValues,
} from '@/api/types/chat-dynamic-form';
import ChatAssistantMessage from './ChatAssistantMessage.vue';

const props = withDefaults(
  defineProps<{
    isSending: boolean;
    conversationId: string | null;
    messages: ChatMessage[];
    streamDuration: string | null;
    hasEarlierMessages?: boolean;
    isLoadingEarlierMessages?: boolean;
    historyError?: string;
    addressSelectionStatus?: (
      draftId: string,
      draftVersion: number,
    ) => ChatAddressSelectionActionStatus;
    addressSelectionError?: (draftId: string, draftVersion: number) => string;
    dynamicFormSubmitting?: (formId: string) => boolean;
    dynamicFormError?: (formId: string) => string;
  }>(),
  {
    hasEarlierMessages: false,
    isLoadingEarlierMessages: false,
    historyError: '',
    dynamicFormSubmitting: () => false,
    dynamicFormError: () => '',
  },
);

const emit = defineEmits<{
  (event: 'loadEarlier'): void;
  (event: 'retryHistory'): void;
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
}>();

const sessionGapMs = 5 * 60 * 1000;
const messagesWithSessionTime = computed(() => {
  let lastAssistantAt: number | null = null;

  return props.messages.map((message) => {
    const currentTime = Date.parse(message.createdAt);
    const showSessionTime =
      message.role === 'user' &&
      (lastAssistantAt === null ||
        (Number.isFinite(currentTime) &&
          currentTime - lastAssistantAt > sessionGapMs));

    // 用助手回复时间衡量会话间隔，不复制消息中的递归工具参数。
    if (message.role === 'assistant' && Number.isFinite(currentTime)) {
      lastAssistantAt = currentTime;
    }
    return { message, showSessionTime };
  });
});

function formatSessionTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <MessageScrollerProvider auto-scroll default-scroll-position="end">
    <MessageScroller class="h-full min-h-0">
      <MessageScrollerViewport aria-label="聊天消息" preserve-scroll-on-prepend>
        <div
          v-if="hasEarlierMessages || historyError"
          class="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 pt-4"
        >
          <p
            v-if="historyError"
            role="status"
            class="text-sm text-muted-foreground"
          >
            更早消息加载失败
          </p>
          <Button
            :disabled="isLoadingEarlierMessages"
            size="sm"
            type="button"
            variant="ghost"
            @click="historyError ? emit('retryHistory') : emit('loadEarlier')"
          >
            <Spinner v-if="isLoadingEarlierMessages" data-icon="inline-start" />
            <RotateCw
              v-else-if="historyError"
              aria-hidden="true"
              data-icon="inline-start"
            />
            <ArrowUp v-else aria-hidden="true" data-icon="inline-start" />
            {{
              isLoadingEarlierMessages
                ? '正在加载'
                : historyError
                  ? '重试加载'
                  : '加载更早消息'
            }}
          </Button>
        </div>
        <MessageScrollerContent
          :aria-busy="isSending"
          class="mx-auto w-full max-w-3xl gap-5 px-0 py-5 sm:py-6"
        >
          <MessageScrollerItem
            v-for="{ message, showSessionTime } in messagesWithSessionTime"
            :key="message.renderKey ?? message.id"
            :message-id="message.id"
            :scroll-anchor="message.role === 'user'"
            class="min-w-0"
          >
            <div
              v-if="showSessionTime"
              class="flex justify-center pb-4 text-xs text-muted-foreground"
              role="separator"
            >
              <time :datetime="message.createdAt">
                {{ formatSessionTime(message.createdAt) }}
              </time>
            </div>
            <Message v-if="message.role === 'user'" align="end">
              <MessageContent>
                <Bubble align="end" variant="muted">
                  <BubbleContent
                    class="whitespace-pre-wrap [overflow-wrap:anywhere]"
                  >
                    {{ message.content }}
                  </BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
            <ChatAssistantMessage
              v-else
              :message="message"
              :is-sending="isSending"
              :conversation-id="conversationId"
              :address-selection-status="addressSelectionStatus"
              :address-selection-error="addressSelectionError"
              :dynamic-form-submitting="dynamicFormSubmitting"
              :dynamic-form-error="dynamicFormError"
              :stream-duration="
                isSending && message.id === messages.at(-1)?.id
                  ? streamDuration
                  : null
              "
              @more-products="
                (messageId, resultIndex) =>
                  emit('moreProducts', messageId, resultIndex)
              "
              @buy-product="(externalId) => emit('buyProduct', externalId)"
              @select-address="(request) => emit('selectAddress', request)"
              @refresh-purchase-draft="
                (conversationId) => emit('refreshPurchaseDraft', conversationId)
              "
              @try-on="(request) => emit('tryOn', request)"
              @open-order="(orderId) => emit('openOrder', orderId)"
              @cancel-candidate-order="
                (orderId) => emit('cancelCandidateOrder', orderId)
              "
              @submit-dynamic-form="
                (form, values) => emit('submitDynamicForm', form, values)
              "
              @cancel-dynamic-form="(form) => emit('cancelDynamicForm', form)"
            />
          </MessageScrollerItem>
          <MessageScrollerItem
            v-if="isSending && messages.at(-1)?.role !== 'assistant'"
            message-id="pending-assistant"
          >
            <Message>
              <MessageContent>
                <p
                  class="flex items-center gap-2 text-muted-foreground"
                  role="status"
                >
                  <Spinner aria-hidden="true" />
                  正在生成回复
                </p>
              </MessageContent>
            </Message>
          </MessageScrollerItem>
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton aria-label="回到最新消息" title="回到最新消息" />
    </MessageScroller>
  </MessageScrollerProvider>
</template>
