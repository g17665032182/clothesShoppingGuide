<script setup lang="ts">
import { ExternalLink, PackageOpen } from '@lucide/vue';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type {
  FashionRecommendationCard,
  RecommendationFeedbackPayload,
} from '@/api/types/fashion-recommendation';
import ChatRecommendationFeedback from '../ChatRecommendationFeedback.vue';

type FeedbackStatus =
  'idle' | 'submitting' | 'accepted' | 'duplicate' | 'disabled' | 'error';

const props = withDefaults(
  defineProps<{
    card: FashionRecommendationCard;
    conversationId: string | null;
    assistantMessageId: string;
    disabled?: boolean;
    feedbackStatus?: (targetRef: string) => FeedbackStatus;
    feedbackError?: (targetRef: string) => string;
  }>(),
  {
    conversationId: null,
    disabled: false,
    feedbackStatus: (_targetRef: string): FeedbackStatus => 'idle',
    feedbackError: (_targetRef: string): string => '',
  },
);

const emit = defineEmits<{
  (event: 'feedback', payload: RecommendationFeedbackPayload): void;
}>();

const visibleItems = computed(() => props.card.data.items.slice(0, 6));
const visibleOutfits = computed(() => props.card.data.outfits.slice(0, 2));

function formatObservedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function emitFeedback(payload: RecommendationFeedbackPayload): void {
  if (props.disabled || !props.conversationId) return;
  emit('feedback', payload);
}
</script>

<template>
  <Card class="min-w-0 rounded-md">
    <CardHeader class="gap-2">
      <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <CardTitle class="break-words text-base">穿搭推荐</CardTitle>
          <CardDescription class="break-words">
            {{ props.card.data.styleSummary }}
          </CardDescription>
        </div>
        <Badge variant="secondary">
          {{
            props.card.data.mode === 'item'
              ? '单品'
              : props.card.data.mode === 'outfit'
                ? '整套'
                : '单品 + 整套'
          }}
        </Badge>
      </div>
      <ChatRecommendationFeedback
        v-if="props.conversationId"
        :recommendation-id="props.card.data.recommendationId"
        :conversation-id="props.conversationId"
        :assistant-message-id="props.assistantMessageId"
        target-type="recommendation"
        :target-ref="props.card.data.recommendationId"
        :status="props.feedbackStatus(props.card.data.recommendationId)"
        :error-message="props.feedbackError(props.card.data.recommendationId)"
        :disabled="props.disabled"
        @submit="emitFeedback"
      />
    </CardHeader>

    <CardContent class="grid min-w-0 gap-5">
      <section
        v-if="visibleOutfits.length"
        class="grid gap-3"
        aria-label="整套穿搭"
      >
        <h3 class="text-sm font-medium">整套方案</h3>
        <div
          v-for="outfit in visibleOutfits"
          :key="outfit.outfitRef"
          class="grid min-w-0 gap-3 rounded-md border p-3"
        >
          <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <p class="min-w-0 break-words text-sm font-medium">
              {{ outfit.styleSummary }}
            </p>
            <p v-if="outfit.total" class="shrink-0 text-sm font-semibold">
              ¥{{ outfit.total.amount }}
            </p>
          </div>
          <ul class="grid min-w-0 gap-3 sm:grid-cols-2">
            <li
              v-for="entry in outfit.items"
              :key="`${outfit.outfitRef}-${entry.targetRef}`"
              class="min-w-0 overflow-hidden rounded-md border"
            >
              <a
                v-if="entry.item.productUrl"
                :href="entry.item.productUrl"
                target="_blank"
                rel="noreferrer"
                class="block"
              >
                <img
                  v-if="entry.item.imageUrl"
                  :src="entry.item.imageUrl"
                  :alt="entry.item.name"
                  class="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
              </a>
              <div v-else-if="entry.item.imageUrl" class="block">
                <img
                  :src="entry.item.imageUrl"
                  :alt="entry.item.name"
                  class="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div class="grid min-w-0 gap-1 p-3">
                <p class="text-xs text-muted-foreground">{{ entry.slot }}</p>
                <p class="break-words text-sm font-medium">
                  {{ entry.item.name }}
                </p>
                <p class="break-words text-xs text-muted-foreground">
                  {{ entry.item.sourceName }} ·
                  {{ formatObservedAt(entry.item.observedAt) }}
                </p>
                <p class="text-sm">
                  <span v-if="entry.item.price && entry.item.currency">
                    ¥{{ entry.item.price }}
                  </span>
                  <span v-else class="text-muted-foreground">价格待核验</span>
                  <span
                    class="ml-2 text-xs"
                    :class="
                      entry.item.inStock
                        ? 'text-emerald-600'
                        : 'text-muted-foreground'
                    "
                  >
                    {{ entry.item.inStock ? '有货' : '暂缺货' }}
                  </span>
                </p>
                <Button
                  v-if="entry.item.productUrl"
                  as-child
                  size="sm"
                  variant="outline"
                  class="mt-1 w-fit"
                >
                  <a
                    :href="entry.item.productUrl"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink data-icon="inline-start" />
                    查看商品
                  </a>
                </Button>
              </div>
            </li>
          </ul>
          <p
            v-if="outfit.missingSlots.length"
            class="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <PackageOpen class="size-3.5" aria-hidden="true" />
            暂缺：{{ outfit.missingSlots.join('、') }}
          </p>
          <ChatRecommendationFeedback
            v-if="props.conversationId"
            :recommendation-id="props.card.data.recommendationId"
            :conversation-id="props.conversationId"
            :assistant-message-id="props.assistantMessageId"
            target-type="outfit"
            :target-ref="outfit.outfitRef"
            :status="props.feedbackStatus(outfit.outfitRef)"
            :error-message="props.feedbackError(outfit.outfitRef)"
            :disabled="props.disabled"
            @submit="emitFeedback"
          />
        </div>
      </section>

      <section
        v-if="visibleItems.length"
        class="grid gap-3"
        aria-label="单品推荐"
      >
        <h3 class="text-sm font-medium">单品参考</h3>
        <ul class="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="item in visibleItems"
            :key="item.targetRef"
            class="min-w-0 overflow-hidden rounded-md border"
          >
            <a
              v-if="item.productUrl"
              :href="item.productUrl"
              target="_blank"
              rel="noreferrer"
              class="block"
            >
              <img
                v-if="item.imageUrl"
                :src="item.imageUrl"
                :alt="item.name"
                class="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />
            </a>
            <img
              v-else-if="item.imageUrl"
              :src="item.imageUrl"
              :alt="item.name"
              class="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
            <div class="grid min-w-0 gap-1 p-3">
              <p class="text-xs text-muted-foreground">{{ item.slot }}</p>
              <p class="break-words text-sm font-medium">{{ item.name }}</p>
              <p class="break-words text-xs text-muted-foreground">
                {{ item.sourceName }} · {{ formatObservedAt(item.observedAt) }}
              </p>
              <p class="text-sm">
                <span v-if="item.price && item.currency"
                  >¥{{ item.price }}</span
                >
                <span v-else class="text-muted-foreground">价格待核验</span>
              </p>
            </div>
          </li>
        </ul>
      </section>
    </CardContent>
  </Card>
</template>
