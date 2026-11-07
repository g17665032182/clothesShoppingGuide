<script setup lang="ts">
import { Eye, PackageSearch } from '@lucide/vue';
import type { AdminProductSummary } from '@/api/types/admin-products';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
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

defineProps<{
  products: AdminProductSummary[];
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (event: 'select', product: AdminProductSummary): void;
}>();

const categoryLabels: Record<AdminProductSummary['category'], string> = {
  tops: '上装',
  bottoms: '下装',
  dresses: '连衣裙',
  outerwear: '外套',
  shoes: '鞋类',
};

function formatMoney(value: string | null) {
  return value ? `¥${value}` : '—';
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Alert v-if="error" variant="destructive">
      <AlertDescription role="alert">{{ error }}</AlertDescription>
    </Alert>
    <div class="overflow-x-auto rounded-lg border">
      <Table class="min-w-[980px]">
        <TableCaption class="sr-only">商品管理列表</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>商品</TableHead>
            <TableHead>分类</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>最低价</TableHead>
            <TableHead>可售 / 实物库存</TableHead>
            <TableHead>状态</TableHead>
            <TableHead class="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="loading">
            <TableCell :colspan="7">
              <div
                class="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
              >
                <Spinner />
                正在加载商品
              </div>
            </TableCell>
          </TableRow>
          <TableRow v-else-if="products.length === 0">
            <TableCell :colspan="7">
              <Empty class="border-0 py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><PackageSearch /></EmptyMedia>
                  <EmptyTitle>没有找到商品</EmptyTitle>
                  <EmptyDescription>调整筛选条件后重试。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </TableCell>
          </TableRow>
          <template v-else>
            <TableRow v-for="product in products" :key="product.id">
              <TableCell class="whitespace-normal">
                <div class="flex min-w-0 max-w-72 flex-col gap-1">
                  <span class="wrap-break-word font-medium">{{
                    product.name
                  }}</span>
                  <span class="break-all text-xs text-muted-foreground">
                    {{ product.brand || '无品牌' }} · {{ product.externalId }}
                  </span>
                </div>
              </TableCell>
              <TableCell>{{ categoryLabels[product.category] }}</TableCell>
              <TableCell>{{ product.skuCount }}</TableCell>
              <TableCell>{{ formatMoney(product.lowestPrice) }}</TableCell>
              <TableCell>
                <span>
                  {{ product.totalAvailableStock }} / {{ product.totalStock }}
                </span>
              </TableCell>
              <TableCell>
                <Badge :variant="product.isActive ? 'secondary' : 'outline'">
                  {{ product.isActive ? '已启用' : '已停用' }}
                </Badge>
              </TableCell>
              <TableCell class="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  @click="emit('select', product)"
                >
                  <Eye data-icon="inline-start" />
                  查看详情
                </Button>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
