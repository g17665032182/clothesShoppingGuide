<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowUpRight, Check, ImageOff } from '@lucide/vue';
import type { ChatProductResults } from '@/api/types/chat';

const props = defineProps<{
  resultSets: ChatProductResults[];
  disabled?: boolean;
}>();
const emit = defineEmits<{
  (event: 'more', resultIndex: number): void;
}>();
const failedImages = ref(new Set<string>());

const categoryLabels: Record<string, string> = {
  tops: '上装',
  bottoms: '下装',
  dresses: '连衣裙',
  outerwear: '外套',
  shoes: '鞋类',
};

const reasonLabels: Record<string, string> = {
  category_match: '品类匹配',
  size_match: '尺码匹配',
  budget_match: '预算匹配',
  stock_available: '有货',
  color_match: '颜色匹配',
  style_match: '风格匹配',
  occasion_match: '场景匹配',
  fit_match: '版型匹配',
  preference_match: '偏好匹配',
};

const emptyReasonLabels: Record<string, string> = {
  NO_MATCHING_SIZE: '没有找到符合该尺码的商品',
  OVER_BUDGET: '没有找到符合预算的商品',
  OUT_OF_STOCK: '符合条件的商品暂时无货',
  NO_MATCHING_PRODUCT: '暂时没有找到符合条件的商品',
};

const resultSets = computed(() =>
  props.resultSets.map((result, index) => ({
    index,
    key: `${index}-${result.items.map((item) => item.externalId).join('|')}`,
    result,
    items: result.items.map((item) => ({
      ...item,
      categoryLabel: categoryLabels[item.category] ?? item.category,
      reasons: item.matchReasons
        .map((reason) => reasonLabels[reason])
        .filter(Boolean),
      productHref: publicUrl(item.productUrl),
      imageSrc: publicUrl(item.imageUrl),
      imageKey: `${index}-${item.externalId}`,
    })),
    emptyLabel: result.noResultReason
      ? emptyReasonLabels[result.noResultReason]
      : '',
    canLoadMore: Boolean(result.nextCursor && result.query),
  })),
);

function publicUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
</script>

<template>
  <section
    v-for="set in resultSets"
    :key="set.key"
    class="min-w-0 space-y-2"
    aria-label="推荐商品"
  >
    <div v-if="set.items.length" class="grid min-w-0 gap-3 sm:grid-cols-2">
      <article
        v-for="item in set.items"
        :key="item.externalId"
        class="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] gap-3 overflow-hidden rounded-md border bg-background p-2"
      >
        <a
          v-if="
            item.imageSrc &&
            !failedImages.has(item.imageKey) &&
            item.productHref
          "
          :href="item.productHref"
          target="_blank"
          rel="noopener noreferrer"
          class="relative block aspect-square overflow-hidden rounded-sm bg-muted"
          :aria-label="`查看商品：${item.name}`"
        >
          <img
            :src="item.imageSrc"
            :alt="item.name"
            class="h-full w-full object-cover"
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="failedImages.add(item.imageKey)"
          />
        </a>
        <div
          v-else-if="item.imageSrc && !failedImages.has(item.imageKey)"
          class="aspect-square overflow-hidden rounded-sm bg-muted"
        >
          <img
            :src="item.imageSrc"
            :alt="item.name"
            class="h-full w-full object-cover"
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="failedImages.add(item.imageKey)"
          />
        </div>
        <div
          v-else
          class="flex aspect-square items-center justify-center rounded-sm bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <ImageOff class="size-5" />
        </div>
        <div class="min-w-0 space-y-1.5">
          <a
            v-if="item.productHref"
            :href="item.productHref"
            target="_blank"
            rel="noopener noreferrer"
            class="flex min-w-0 items-start gap-1 font-medium leading-5 hover:underline"
          >
            <span class="line-clamp-2 min-w-0 wrap-break-word">{{
              item.name
            }}</span>
            <ArrowUpRight class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          </a>
          <p v-else class="line-clamp-2 wrap-break-word font-medium leading-5">
            {{ item.name }}
          </p>
          <p class="truncate text-xs text-muted-foreground">
            {{ item.brand || item.categoryLabel }}
          </p>
          <p class="font-semibold tabular-nums">¥{{ item.price }}</p>
          <p
            class="flex items-center gap-1 text-xs"
            :class="item.inStock ? 'text-emerald-700' : 'text-muted-foreground'"
          >
            <Check v-if="item.inStock" class="size-3.5" aria-hidden="true" />
            {{ item.inStock ? '有货' : '无货' }}
            <span v-if="item.sizes.length" class="truncate">
              · {{ item.sizes.join(' / ') }}
            </span>
          </p>
          <div
            v-if="item.reasons.length"
            class="flex flex-wrap gap-x-2 gap-y-1"
          >
            <span
              v-for="reason in item.reasons"
              :key="reason"
              class="text-xs text-muted-foreground"
            >
              {{ reason }}
            </span>
          </div>
        </div>
      </article>
    </div>
    <p v-else-if="set.emptyLabel" class="text-sm text-muted-foreground">
      {{ set.emptyLabel }}
    </p>
    <button
      v-if="set.canLoadMore"
      type="button"
      class="text-sm font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="disabled || set.result.loadingMore"
      @click="emit('more', set.index)"
    >
      {{ set.result.loadingMore ? '正在加载' : '查看更多商品' }}
    </button>
    <p
      v-if="set.result.loadMoreError"
      class="text-sm text-destructive"
      role="alert"
    >
      {{ set.result.loadMoreError }}
    </p>
  </section>
</template>
