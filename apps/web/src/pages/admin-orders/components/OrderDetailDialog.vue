<script setup lang="ts">
import { Truck } from '@lucide/vue';
import type {
  AdminOrderDetail,
  AdminOrderStatus,
} from '@/api/types/admin-orders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import OrderProgress from '@/components/shared/orders/OrderProgress.vue';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import OrderItemImage from './OrderItemImage.vue';

defineProps<{
  modelValue: boolean;
  order: AdminOrderDetail | null;
  loading: boolean;
  error: string;
  statusLabels: Record<AdminOrderStatus, string>;
}>();
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'ship'): void;
  (event: 'retry'): void;
}>();
</script>

<template>
  <Dialog :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>订单详情</DialogTitle>
        <DialogDescription class="break-all">{{
          order?.orderNo ?? '正在读取订单'
        }}</DialogDescription>
      </DialogHeader>
      <div v-if="loading && !order" class="flex flex-col gap-4">
        <Skeleton class="h-8 w-1/2" /><Skeleton class="h-40 w-full" />
      </div>
      <div v-if="error" class="flex flex-col items-start gap-3">
        <p role="status" class="text-sm text-muted-foreground">
          订单详情尚未加载，请重新读取。
        </p>
        <Button variant="outline" @click="emit('retry')">重新读取</Button>
      </div>
      <template v-if="order">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <Badge variant="secondary">{{ statusLabels[order.status] }}</Badge>
            <Badge variant="outline">模拟支付</Badge>
          </div>
          <Button
            v-if="order.status === 'pending_shipment'"
            @click="emit('ship')"
          >
            <Truck data-icon="inline-start" />整单发货
          </Button>
        </div>
        <dl class="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted-foreground">买家 ID</dt>
            <dd class="mt-1 break-all">{{ order.userId }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">实付金额</dt>
            <dd class="mt-1 font-medium">¥{{ order.payableAmount }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">收件人</dt>
            <dd class="mt-1 break-all">
              {{ order.recipient.name }} · {{ order.recipient.phone }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">收货地址</dt>
            <dd class="mt-1 break-all">{{ order.recipient.address }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">物流</dt>
            <dd class="mt-1 break-all">
              {{
                order.shipment
                  ? `${order.shipment.carrier} · ${order.shipment.trackingNo}`
                  : '未发货'
              }}
            </dd>
          </div>
        </dl>
        <OrderProgress :order="order" />
        <div class="overflow-x-auto rounded-lg border">
          <Table class="min-w-[560px]">
            <TableHeader
              ><TableRow
                ><TableHead>商品</TableHead><TableHead>规格</TableHead
                ><TableHead>单价</TableHead><TableHead>数量</TableHead
                ><TableHead class="text-right">小计</TableHead></TableRow
              ></TableHeader
            >
            <TableBody>
              <TableRow v-for="item in order.items" :key="item.skuId">
                <TableCell>
                  <div class="flex items-center gap-3">
                    <OrderItemImage
                      :src="item.imageUrl"
                      :alt="item.productName"
                    />
                    <div class="flex max-w-64 flex-col gap-1">
                      <span class="break-all font-medium">{{
                        item.productName
                      }}</span
                      ><span class="break-all text-xs text-muted-foreground">{{
                        item.productExternalId
                      }}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell class="max-w-32 break-all"
                  >{{ item.color }} / {{ item.size }}</TableCell
                >
                <TableCell>¥{{ item.unitPrice }}</TableCell>
                <TableCell>{{ item.quantity }}</TableCell>
                <TableCell class="text-right">¥{{ item.lineAmount }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>
