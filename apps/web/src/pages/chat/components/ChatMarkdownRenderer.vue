<script setup lang="ts">
import type { ChatCard } from '@/api/types/chat';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import ChatCardTemplate from './ChatCardTemplate.vue';

const props = defineProps<{
  markdown: string;
  cards: ChatCard[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'buyProduct', externalId: string): void;
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
        @buy-product="(externalId) => emit('buyProduct', externalId)"
      />
    </section>
  </div>
</template>
