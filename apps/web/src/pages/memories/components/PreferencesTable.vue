<script setup lang="ts">
import { Pencil, Star, Trash2 } from '@lucide/vue';
import type { PreferenceRecord } from '@/api/types/preferences';
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
  formatPreferenceDate,
  formatPreferenceSource,
  formatPreferenceValue,
} from '../preference-display';

defineProps<{
  records: PreferenceRecord[];
  deletingId: string | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  edit: [record: PreferenceRecord];
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
      <TableRow v-for="preference in records" :key="preference.id">
        <TableCell class="py-4 pl-3 align-top sm:pl-4">
          <div class="flex flex-col items-start gap-2">
            <span>{{ categoryLabel(preference.category) }}</span>
            <Badge v-if="preference.isPrimary" variant="secondary">
              <Star aria-hidden="true" data-icon="inline-start" />
              主要
            </Badge>
          </div>
        </TableCell>
        <TableCell class="py-4 align-top whitespace-normal">
          <p class="wrap-break-word leading-6">
            {{ formatPreferenceValue(preference) }}
          </p>
          <div
            class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground lg:hidden"
          >
            <span>{{ formatPreferenceSource(preference) }}</span>
            <time :datetime="preference.updatedAt" class="md:hidden">{{
              formatPreferenceDate(preference.updatedAt)
            }}</time>
          </div>
        </TableCell>
        <TableCell
          class="hidden py-4 align-top text-muted-foreground lg:table-cell"
        >
          {{ formatPreferenceSource(preference) }}
        </TableCell>
        <TableCell
          class="hidden py-4 align-top text-muted-foreground md:table-cell"
        >
          <time :datetime="preference.updatedAt">{{
            formatPreferenceDate(preference.updatedAt)
          }}</time>
        </TableCell>
        <TableCell class="py-3 pr-3 align-top sm:pr-4">
          <div class="flex justify-end gap-1">
            <Button
              :aria-label="`编辑${categoryLabel(preference.category)}`"
              :title="`编辑${categoryLabel(preference.category)}`"
              :disabled="busy"
              size="icon-sm"
              type="button"
              variant="ghost"
              @click="emit('edit', preference)"
            >
              <Pencil aria-hidden="true" data-icon="inline-start" />
            </Button>
            <Button
              :aria-label="`删除${categoryLabel(preference.category)}`"
              :title="`删除${categoryLabel(preference.category)}`"
              :disabled="busy"
              size="icon-sm"
              type="button"
              variant="ghost"
              @click="emit('delete', preference.id)"
            >
              <Spinner
                v-if="deletingId === preference.id"
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
