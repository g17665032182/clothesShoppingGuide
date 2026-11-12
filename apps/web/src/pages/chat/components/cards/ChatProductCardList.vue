<script setup lang="ts">
import { computed } from 'vue';
import type { ChatProductCard, ChatProductResults } from '@/api/types/chat';
import ChatProductResultsView from '../ChatProductResults.vue';

const props = defineProps<{
  items: ChatProductCard[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'buy', externalId: string): void;
  (event: 'tryOn', product: ChatProductCard): void;
}>();

const resultSets = computed<ChatProductResults[]>(() => [
  {
    items: props.items,
    nextCursor: null,
    noResultReason: null,
  },
]);

// 通用卡片没有分页游标，只复用商品列表的展示和购买交互。
</script>

<template>
  <ChatProductResultsView
    :result-sets="resultSets"
    :disabled="props.disabled"
    @buy="(externalId) => emit('buy', externalId)"
    @try-on="(product) => emit('tryOn', product)"
  />
</template>
