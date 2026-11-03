<script setup lang="ts">
import { Pencil, Star, Trash2 } from '@lucide/vue';
import type { MemoryRecord } from '@/api/types/memories';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  categoryLabel,
  formatMemoryDate,
  formatMemorySource,
  formatMemoryValue,
} from '../preference-display';

defineProps<{
  records: MemoryRecord[];
  deletingId: string | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  edit: [record: MemoryRecord];
  delete: [id: string];
}>();
</script>

<template>
  <Table class="table-fixed">
    <TableCaption class="sr-only">用户穿搭偏好</TableCaption>
    <TableHeader>
      <TableRow class="bg-muted/50">
        <TableHead class="w-24 pl-3 sm:w-32 sm:pl-4">类别</TableHead>
        <TableHead>偏好内容</TableHead>
        <TableHead class="hidden w-32 lg:table-cell">来源</TableHead>
        <TableHead class="hidden w-28 md:table-cell">最近更新</TableHead>
        <TableHead class="w-20 pr-3 text-right sm:w-24 sm:pr-4">操作</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="memory in records" :key="memory.id">
        <TableCell class="py-4 pl-3 align-top sm:pl-4">
          <div class="flex flex-col items-start gap-2">
            <span>{{ categoryLabel(memory.category) }}</span>
            <Badge v-if="memory.isPrimary" variant="secondary">
              <Star aria-hidden="true" data-icon="inline-start" />
              主要
            </Badge>
          </div>
        </TableCell>
        <TableCell class="py-4 align-top whitespace-normal">
          <p class="break-words leading-6 [overflow-wrap:anywhere]">
            {{ formatMemoryValue(memory) }}
          </p>
          <div
            class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground lg:hidden"
          >
            <span>{{ formatMemorySource(memory) }}</span>
            <time :datetime="memory.updatedAt" class="md:hidden">{{
              formatMemoryDate(memory.updatedAt)
            }}</time>
          </div>
        </TableCell>
        <TableCell
          class="hidden py-4 align-top text-muted-foreground lg:table-cell"
        >
          {{ formatMemorySource(memory) }}
        </TableCell>
        <TableCell
          class="hidden py-4 align-top text-muted-foreground md:table-cell"
        >
          <time :datetime="memory.updatedAt">{{
            formatMemoryDate(memory.updatedAt)
          }}</time>
        </TableCell>
        <TableCell class="py-3 pr-3 align-top sm:pr-4">
          <div class="flex justify-end gap-1">
            <Button
              :aria-label="`编辑${categoryLabel(memory.category)}`"
              :title="`编辑${categoryLabel(memory.category)}`"
              :disabled="busy"
              size="icon-sm"
              type="button"
              variant="ghost"
              @click="emit('edit', memory)"
            >
              <Pencil aria-hidden="true" data-icon="inline-start" />
            </Button>
            <Button
              :aria-label="`删除${categoryLabel(memory.category)}`"
              :title="`删除${categoryLabel(memory.category)}`"
              :disabled="busy"
              size="icon-sm"
              type="button"
              variant="ghost"
              @click="emit('delete', memory.id)"
            >
              <Spinner
                v-if="deletingId === memory.id"
                aria-hidden="true"
                data-icon="inline-start"
              />
              <Trash2 v-else aria-hidden="true" data-icon="inline-start" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
