<script setup lang="ts">
import { Eye, PackageSearch } from '@lucide/vue';
import type {
  AdminOrderStatus,
  AdminOrderSummary,
} from '@/api/types/admin-orders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
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
  orders: AdminOrderSummary[];
  loading: boolean;
  statusLabels: Record<AdminOrderStatus, string>;
}>();
const emit = defineEmits<{ (event: 'view', id: string): void }>();

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <div class="overflow-x-auto rounded-lg border">
    <Table class="min-w-[980px]">
      <TableCaption class="sr-only">管理员订单列表</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>订单</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>金额 / 件数</TableHead>
          <TableHead>创建时间</TableHead>
          <TableHead>发货时间</TableHead>
          <TableHead class="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-if="loading">
          <TableRow v-for="index in 5" :key="index">
            <TableCell v-for="column in 6" :key="column"
              ><Skeleton class="h-5 w-full"
            /></TableCell>
          </TableRow>
        </template>
        <TableRow v-else-if="orders.length === 0">
          <TableCell :colspan="6">
            <Empty class="border-0 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon"><PackageSearch /></EmptyMedia>
                <EmptyTitle>暂无匹配订单</EmptyTitle>
              </EmptyHeader>
            </Empty>
          </TableCell>
        </TableRow>
        <template v-else>
          <TableRow v-for="order in orders" :key="order.id">
            <TableCell>
              <div class="flex flex-col gap-1">
                <span class="max-w-64 break-all font-medium">{{
                  order.orderNo
                }}</span>
                <span
                  class="max-w-64 break-all text-xs text-muted-foreground"
                  >{{ order.userId }}</span
                >
              </div>
            </TableCell>
            <TableCell
              ><Badge
                :variant="order.status === 'closed' ? 'outline' : 'secondary'"
                >{{ statusLabels[order.status] }}</Badge
              ></TableCell
            >
            <TableCell>
              <div class="flex flex-col gap-1">
                <span class="font-medium">¥{{ order.payableAmount }}</span>
                <span class="text-xs text-muted-foreground"
                  >{{ order.itemCount }} 件 · 模拟支付</span
                >
              </div>
            </TableCell>
            <TableCell>{{ formatDate(order.createdAt) }}</TableCell>
            <TableCell>{{ formatDate(order.shippedAt) }}</TableCell>
            <TableCell class="text-right">
              <Button
                variant="outline"
                size="sm"
                @click="emit('view', order.id)"
              >
                <Eye data-icon="inline-start" />详情
              </Button>
            </TableCell>
          </TableRow>
        </template>
      </TableBody>
    </Table>
  </div>
</template>
