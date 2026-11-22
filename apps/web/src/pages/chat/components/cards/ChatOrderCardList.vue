<script setup lang="ts">
import type { ChatOrderCardSummary } from '@/api/types/chat';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

defineProps<{
  orders: ChatOrderCardSummary[];
}>();

const statusLabels: Record<ChatOrderCardSummary['status'], string> = {
  pending_payment: '待付款',
  pending_shipment: '待发货',
  pending_receipt: '待收货',
  completed: '已完成',
  closed: '已关闭',
};

const closeReasonLabels: Record<
  Exclude<ChatOrderCardSummary['closeReason'], null>,
  string
> = {
  user_cancelled: '用户取消',
  payment_expired: '付款超时',
  product_unavailable: '商品暂不可用',
};

function formatOrderDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

// 订单卡仅展示安全摘要，不接收或发出任何订单写操作。
</script>

<template>
  <section class="grid min-w-0 gap-3" aria-label="订单列表">
    <Card
      v-for="order in orders"
      :key="order.orderNo"
      class="min-w-0 rounded-md"
    >
      <CardHeader
        class="flex flex-row flex-wrap items-start justify-between gap-3 pb-3"
      >
        <div class="min-w-0">
          <h3 class="break-all text-sm font-medium">
            订单号 {{ order.orderNo }}
          </h3>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ statusLabels[order.status] }} · 创建于
            {{ formatOrderDate(order.createdAt) }}
          </p>
          <p
            v-if="order.status === 'closed' && order.closeReason"
            class="mt-1 text-xs text-muted-foreground"
          >
            {{ closeReasonLabels[order.closeReason] }}
          </p>
        </div>
        <p class="shrink-0 font-medium tabular-nums">
          ¥{{ order.payableAmount }}
        </p>
      </CardHeader>
      <CardContent class="grid min-w-0 gap-2 pt-0">
        <p class="text-xs text-muted-foreground">
          共 {{ order.itemCount }} 件商品
        </p>
        <ul class="grid min-w-0 gap-2 text-sm">
          <li
            v-for="(item, index) in order.items"
            :key="`${order.orderNo}-${index}`"
            class="wrap-break-word text-muted-foreground"
          >
            {{ item.productName }} · {{ item.color }} · {{ item.size }} ×
            {{ item.quantity }}
          </li>
        </ul>
      </CardContent>
    </Card>
  </section>
</template>
