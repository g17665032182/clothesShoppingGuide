<script setup lang="ts">
import type {
  ChatAddressSelectionActionStatus,
  ChatAddressSelectionRequest,
  ChatCard,
  ChatProductCard,
} from '@/api/types/chat';
import type { RecommendationFeedbackPayload } from '@/api/types/fashion-recommendation';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import ChatCardTemplate from './ChatCardTemplate.vue';

const props = defineProps<{
  markdown: string;
  cards: ChatCard[];
  disabled?: boolean;
  conversationId: string | null;
  assistantMessageId: string;
  recommendationFeedbackStatus?: (
    targetRef: string,
  ) => 'idle' | 'submitting' | 'accepted' | 'duplicate' | 'disabled' | 'error';
  recommendationFeedbackError?: (targetRef: string) => string;
  addressSelectionStatus?: (
    draftId: string,
    draftVersion: number,
  ) => ChatAddressSelectionActionStatus;
  addressSelectionError?: (draftId: string, draftVersion: number) => string;
}>();

const emit = defineEmits<{
  (event: 'buyProduct', externalId: string): void;
  (event: 'selectAddress', request: ChatAddressSelectionRequest): void;
  (event: 'refreshPurchaseDraft', conversationId: string): void;
  (event: 'tryOn', product: ChatProductCard): void;
  (
    event: 'recommendationFeedback',
    payload: RecommendationFeedbackPayload,
  ): void;
}>();

// 卡片由独立服务端投影传入，Markdown 正文始终只交给开启净化的通用渲染器。
</script>

<template>
  <div class="grid min-w-0 gap-3">
    <MarkdownRenderer
      v-if="props.markdown"
      class="max-w-full"
      :markdown="props.markdown"
    />
    <section
      v-if="props.cards.length"
      class="grid min-w-0 gap-3"
      aria-label="结构化展示"
    >
      <ChatCardTemplate
        v-for="(card, index) in props.cards"
        :key="`${card.name}-${index}`"
        :card="card"
        :disabled="props.disabled"
        :conversation-id="props.conversationId"
        :assistant-message-id="props.assistantMessageId"
        :recommendation-feedback-status="props.recommendationFeedbackStatus"
        :recommendation-feedback-error="props.recommendationFeedbackError"
        :address-selection-status="props.addressSelectionStatus"
        :address-selection-error="props.addressSelectionError"
        @buy-product="(externalId) => emit('buyProduct', externalId)"
        @select-address="(request) => emit('selectAddress', request)"
        @refresh-purchase-draft="
          (conversationId) => emit('refreshPurchaseDraft', conversationId)
        "
        @try-on="(product) => emit('tryOn', product)"
        @recommendation-feedback="
          (payload) => emit('recommendationFeedback', payload)
        "
      />
    </section>
  </div>
</template>
