<script setup lang="ts">
import { Eye, RotateCcw } from '@lucide/vue';
import type { AdminReturnRefundApplicationSummary } from '@/api/types/admin-return-refunds';
import type { ReturnRefundStatus } from '@/api/types/return-refund';
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{
  applications: AdminReturnRefundApplicationSummary[];
  loading: boolean;
  statusLabels: Record<ReturnRefundStatus, string>;
}>();
const emit = defineEmits<{
  view: [applicationId: string];
  refresh: [];
}>();

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <div class="overflow-x-auto rounded-md border">
    <Table class="min-w-205">
      <TableHeader>
        <TableRow>
          <TableHead>订单</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>申请金额</TableHead>
          <TableHead>商品数</TableHead>
          <TableHead>创建时间</TableHead>
          <TableHead class="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-if="loading">
          <TableRow v-for="row in 5" :key="row">
            <TableCell v-for="column in 6" :key="column">
              <Skeleton class="h-5 w-full" />
            </TableCell>
          </TableRow>
        </template>
        <TableRow v-else-if="applications.length === 0">
          <TableCell :colspan="6">
            <Empty class="border-0 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon"><RotateCcw /></EmptyMedia>
                <EmptyTitle>暂无售后申请</EmptyTitle>
              </EmptyHeader>
            </Empty>
          </TableCell>
        </TableRow>
        <template v-else>
          <TableRow v-for="application in applications" :key="application.id">
            <TableCell class="max-w-60 break-all font-medium">
              {{ application.orderNo }}
              <p
                v-if="application.manualReviewRequired"
                class="mt-1 text-xs text-muted-foreground"
              >
                待人工审核
              </p>
            </TableCell>
            <TableCell>
              <Badge variant="outline">
                {{ statusLabels[application.status] }}
              </Badge>
            </TableCell>
            <TableCell>
              {{ application.currency }} {{ application.refundAmount }}
            </TableCell>
            <TableCell>{{ application.itemCount }}</TableCell>
            <TableCell>{{ formatDate(application.createdAt) }}</TableCell>
            <TableCell class="text-right">
              <Button
                variant="outline"
                size="sm"
                @click="emit('view', application.id)"
              >
                <Eye data-icon="inline-start" />审核详情
              </Button>
            </TableCell>
          </TableRow>
        </template>
      </TableBody>
    </Table>
  </div>
</template>
