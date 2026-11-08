<script setup lang="ts">
import { Eye, PackageSearch } from '@lucide/vue';
import type { OrderSummary } from '@/api/types/orders';
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
import OrderStatusBadge from './OrderStatusBadge.vue';

defineProps<{
  orders: OrderSummary[];
  status: 'idle' | 'loading' | 'success' | 'empty' | 'error';
}>();
const emit = defineEmits<{ (event: 'view', id: string): void }>();

function formatDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '-';
}
</script>

<template>
  <div class="overflow-x-auto rounded-lg border">
    <Table class="min-w-[760px]">
      <TableCaption class="sr-only">我的订单列表</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>订单</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>金额 / 件数</TableHead>
          <TableHead>创建时间</TableHead>
          <TableHead class="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-if="status === 'loading'">
          <TableRow v-for="row in 5" :key="row">
            <TableCell v-for="column in 5" :key="column"
              ><Skeleton class="h-5 w-full"
            /></TableCell>
          </TableRow>
        </template>
        <TableRow v-else-if="!orders.length">
          <TableCell :colspan="5">
            <Empty class="border-0 py-10">
              <EmptyHeader
                ><EmptyMedia variant="icon"><PackageSearch /></EmptyMedia
                ><EmptyTitle>暂无订单</EmptyTitle></EmptyHeader
              >
            </Empty>
          </TableCell>
        </TableRow>
        <TableRow v-for="order in orders" v-else :key="order.id">
          <TableCell
            ><span class="break-all font-medium">{{
              order.orderNo
            }}</span></TableCell
          >
          <TableCell><OrderStatusBadge :status="order.status" /></TableCell>
          <TableCell>
            <div class="flex flex-col gap-1">
              <span class="font-medium">¥{{ order.payableAmount }}</span>
              <span class="text-xs text-muted-foreground"
                >{{ order.itemCount }} 件 · 模拟支付</span
              >
            </div>
          </TableCell>
          <TableCell>{{ formatDate(order.createdAt) }}</TableCell>
          <TableCell class="text-right">
            <Button variant="outline" size="sm" @click="emit('view', order.id)"
              ><Eye data-icon="inline-start" />详情</Button
            >
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
