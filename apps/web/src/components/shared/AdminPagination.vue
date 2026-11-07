<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

const props = withDefaults(
  defineProps<{
    page: number;
    pageSize: number;
    total: number;
    disabled?: boolean;
  }>(),
  { disabled: false },
);
const emit = defineEmits<{ 'update:page': [value: number] }>();
const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.total / props.pageSize)),
);

function updatePage(page: number) {
  if (!props.disabled && page >= 1 && page <= totalPages.value)
    emit('update:page', page);
}
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3 py-3">
    <p class="text-sm text-muted-foreground" aria-live="polite">
      共 {{ total }} 条，第 {{ page }} / {{ totalPages }} 页
    </p>
    <Pagination
      :page="page"
      :items-per-page="pageSize"
      :total="total"
      :disabled="disabled"
      :sibling-count="0"
      class="mx-0 w-auto"
      aria-label="列表分页"
      @update:page="updatePage"
    >
      <PaginationContent v-slot="{ items }">
        <PaginationPrevious size="icon" aria-label="上一页" title="上一页">
          <ChevronLeft />
        </PaginationPrevious>
        <template
          v-for="(item, index) in items"
          :key="item.type === 'page' ? item.value : `ellipsis-${index}`"
        >
          <PaginationItem
            v-if="item.type === 'page'"
            :value="item.value"
            :is-active="item.value === page"
            :aria-label="`第 ${item.value} 页`"
          >
            {{ item.value }}
          </PaginationItem>
          <PaginationEllipsis v-else :index="index">
            <span aria-hidden="true">...</span>
            <span class="sr-only">更多页</span>
          </PaginationEllipsis>
        </template>
        <PaginationNext size="icon" aria-label="下一页" title="下一页">
          <ChevronRight />
        </PaginationNext>
      </PaginationContent>
    </Pagination>
  </div>
</template>
