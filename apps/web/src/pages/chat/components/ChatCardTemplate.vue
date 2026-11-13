<script setup lang="ts">
import type { ChatCard } from '@/api/types/chat';
import ChatOrderCardList from './cards/ChatOrderCardList.vue';
import ChatAddressSelectionCard from './cards/ChatAddressSelectionCard.vue';
import ChatProductCardList from './cards/ChatProductCardList.vue';
import type {
  ChatAddressSelectionActionStatus,
  ChatAddressSelectionRequest,
} from '@/api/types/chat';

const props = defineProps<{
  card: ChatCard;
  disabled?: boolean;
  conversationId: string | null;
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
  (
    event: 'tryOn',
    product: Extract<ChatCard, { name: 'product' }>['data']['items'][number],
  ): void;
}>();

// 固定模板映射，不根据消息数据动态解析组件名或路径。
</script>

<template>
  <ChatProductCardList
    v-if="props.card.name === 'product'"
    :items="props.card.data.items"
    :disabled="props.disabled"
    @buy="(externalId) => emit('buyProduct', externalId)"
    @try-on="(product) => emit('tryOn', product)"
  />
  <ChatOrderCardList
    v-else-if="props.card.name === 'order'"
    :orders="props.card.data.items"
  />
  <ChatAddressSelectionCard
    v-else-if="props.card.name === 'address_selection'"
    :card="props.card.data"
    :conversation-id="props.conversationId"
    :disabled="props.disabled"
    :selection-status="
      props.addressSelectionStatus?.(
        props.card.data.draftId,
        props.card.data.draftVersion,
      ) ?? 'idle'
    "
    :selection-error="
      props.addressSelectionError?.(
        props.card.data.draftId,
        props.card.data.draftVersion,
      ) ?? ''
    "
    @select="(request) => emit('selectAddress', request)"
    @refresh-draft="
      (conversationId) => emit('refreshPurchaseDraft', conversationId)
    "
  />
</template>
