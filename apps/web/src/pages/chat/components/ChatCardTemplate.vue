<script setup lang="ts">
import type { ChatCard } from '@/api/types/chat';
import ChatOrderCardList from './cards/ChatOrderCardList.vue';
import ChatProductCardList from './cards/ChatProductCardList.vue';

const props = defineProps<{
  card: ChatCard;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'buyProduct', externalId: string): void;
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
</template>
