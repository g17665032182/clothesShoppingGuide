<script setup lang="ts">
import type { OrderStatus } from '@/api/types/orders';
import { Badge } from '@/components/ui/badge';

defineProps<{ status: OrderStatus }>();

const labels: Record<OrderStatus, string> = {
  pending_payment: '待支付',
  pending_shipment: '待发货',
  pending_receipt: '待收货',
  completed: '已完成',
  closed: '已关闭',
};
</script>

<template>
  <Badge :variant="status === 'closed' ? 'outline' : 'secondary'">{{
    labels[status]
  }}</Badge>
</template>
