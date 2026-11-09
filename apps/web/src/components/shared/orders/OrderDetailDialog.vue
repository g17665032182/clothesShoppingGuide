<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CheckCircle2, CreditCard, XCircle } from '@lucide/vue';
import type { OrderDetail } from '@/api/types/orders';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import OrderStatusBadge from './OrderStatusBadge.vue';

const props = defineProps<{
  modelValue: boolean;
  order: OrderDetail | null;
  status: 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'unknown';
  actionStatus: 'idle' | 'submitting' | 'unknown' | 'error';
  error: string;
}>();
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'retry'): void;
  (event: 'pay' | 'cancel' | 'receipt'): void;
}>();
const now = ref(Date.now());
let paymentTimer: ReturnType<typeof setInterval> | undefined;
let refreshedExpiry: string | null = null;
const paymentExpired = computed(() =>
  Boolean(props.order && Date.parse(props.order.expiresAt) <= now.value),
);

function clearPaymentTimer(): void {
  if (paymentTimer) clearInterval(paymentTimer);
  paymentTimer = undefined;
}

watch(
  () =>
    [
      props.modelValue,
      props.order?.id,
      props.order?.status,
      props.order?.expiresAt,
      props.status,
      props.actionStatus,
    ] as const,
  ([open, orderId, orderStatus, expiresAt]) => {
    clearPaymentTimer();
    if (!open) {
      refreshedExpiry = null;
      return;
    }
    if (!orderId || orderStatus !== 'pending_payment' || !expiresAt) return;
    now.value = Date.now();
    const expiryKey = `${orderId}:${expiresAt}`;
    const verifyExpiry = () => {
      now.value = Date.now();
      if (Date.parse(expiresAt) <= now.value) {
        clearPaymentTimer();
        // 先记录核实键再触发刷新，避免旧订单仍待支付时反复请求。
        if (
          props.status === 'success' &&
          props.actionStatus === 'idle' &&
          refreshedExpiry !== expiryKey
        ) {
          refreshedExpiry = expiryKey;
          emit('retry');
        }
        return true;
      }
      return false;
    };
    if (!verifyExpiry()) paymentTimer = setInterval(verifyExpiry, 1000);
  },
  { immediate: true },
);
onBeforeUnmount(clearPaymentTimer);
const actionsDisabled = computed(
  () => props.status !== 'success' || props.actionStatus !== 'idle',
);

function formatDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '-';
}
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
      <div v-if="status === 'loading' && !order" class="flex flex-col gap-4">
        <Skeleton class="h-8 w-1/2" /><Skeleton class="h-40 w-full" />
      </div>
      <div
        v-if="
          error ||
          status === 'unknown' ||
          actionStatus === 'unknown' ||
          actionStatus === 'error'
        "
        class="flex flex-col items-start gap-3"
      >
        <p role="status" class="text-sm text-muted-foreground">
          {{
            status === 'unknown' || actionStatus === 'unknown'
              ? '操作结果尚未确认，请重新读取核实后再操作。'
              : '订单信息需要重新读取后再操作。'
          }}
        </p>
        <Button variant="outline" @click="emit('retry')">重新读取</Button>
      </div>
      <template v-if="order">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <OrderStatusBadge :status="order.status" /><Badge variant="outline"
              >模拟支付</Badge
            >
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              v-if="order.status === 'pending_payment'"
              :disabled="actionsDisabled || paymentExpired"
              @click="emit('pay')"
              ><CreditCard data-icon="inline-start" />模拟支付</Button
            >
            <Button
              v-if="order.status === 'pending_payment'"
              variant="outline"
              :disabled="actionsDisabled"
              @click="emit('cancel')"
              ><XCircle data-icon="inline-start" />取消订单</Button
            >
            <Button
              v-if="order.status === 'pending_receipt'"
              :disabled="actionsDisabled"
              @click="emit('receipt')"
              ><CheckCircle2 data-icon="inline-start" />确认收货</Button
            >
          </div>
        </div>
        <Alert v-if="paymentExpired && order.status === 'pending_payment'"
          ><AlertDescription
            >支付截止时间已到，正在向服务端核实订单状态。</AlertDescription
          ></Alert
        >
        <dl class="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted-foreground">应付金额</dt>
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
          <div>
            <dt class="text-muted-foreground">创建 / 支付截止 / 支付</dt>
            <dd class="mt-1">
              {{ formatDate(order.createdAt) }} /
              {{ formatDate(order.expiresAt) }} / {{ formatDate(order.paidAt) }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">发货 / 完成</dt>
            <dd class="mt-1">
              {{ formatDate(order.shippedAt) }} /
              {{ formatDate(order.completedAt) }}
            </dd>
          </div>
        </dl>
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
                <TableCell
                  ><div class="flex items-center gap-3">
                    <img
                      v-if="item.imageUrl"
                      :src="item.imageUrl"
                      :alt="item.productName"
                      class="size-12 rounded-sm object-cover"
                    /><span class="max-w-64 break-all font-medium">{{
                      item.productName
                    }}</span>
                  </div></TableCell
                >
                <TableCell>{{ item.color }} / {{ item.size }}</TableCell>
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
