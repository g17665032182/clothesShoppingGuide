<script setup lang="ts">
import { ref } from 'vue';
import { RefreshCw, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import AdminPagination from '@/components/shared/AdminPagination.vue';
import OrderActionDialog from '@/components/shared/orders/OrderActionDialog.vue';
import OrderDetailDialog from '@/components/shared/orders/OrderDetailDialog.vue';
import OrderList from '@/components/shared/orders/OrderList.vue';
import type { OrderStatus } from '@/api/types/orders';
import ReturnRefundApplicationDialog from './components/ReturnRefundApplicationDialog.vue';
import ReturnRefundApplicationsPanel from './components/ReturnRefundApplicationsPanel.vue';
import { useOrdersPage } from './page';

const returnRefundDialogOpen = ref(false);
const returnRefundOrderId = ref<string | null>(null);
const returnRefundRefresh = ref(0);

const statusLabels: Record<OrderStatus, string> = {
  pending_payment: '待支付',
  pending_shipment: '待发货',
  pending_receipt: '待收货',
  completed: '已完成',
  closed: '已关闭',
};
const {
  query,
  pageData,
  listStatus,
  detailStatus,
  detailError,
  selectedOrder,
  detailOpen,
  actionStatus,
  actionDialogOpen,
  actionType,
  loadOrders,
  openOrder,
  setStatus,
  setOrderNo,
  goToPage,
  requestAction,
  requestPayment,
  confirmAction,
  retryDetail,
} = useOrdersPage();

function startReturnRefundApplication(): void {
  if (!selectedOrder.value) return;
  returnRefundOrderId.value = selectedOrder.value.id;
  detailOpen.value = false;
  returnRefundDialogOpen.value = true;
}

function onReturnRefundCreated(): void {
  returnRefundRefresh.value += 1;
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-6 py-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">我的订单</h1>
        <p class="text-sm text-muted-foreground">{{ pageData.total }} 笔订单</p>
      </div>
      <Button
        variant="outline"
        size="icon"
        title="刷新订单"
        aria-label="刷新订单"
        :disabled="listStatus === 'loading'"
        @click="loadOrders"
        ><RefreshCw
      /></Button>
    </div>
    <FieldGroup
      class="grid gap-3 md:grid-cols-[minmax(180px,1fr)_160px_auto] md:items-end"
    >
      <Field
        ><FieldLabel for="order-number">订单号</FieldLabel
        ><Input
          id="order-number"
          :model-value="query.orderNo ?? ''"
          placeholder="精确查询订单号"
          @change="setOrderNo(($event.target as HTMLInputElement).value)"
      /></Field>
      <Field
        ><FieldLabel for="order-status">订单状态</FieldLabel
        ><Select
          :model-value="query.status ?? 'all'"
          @update:model-value="
            setStatus(
              $event === 'all' ? undefined : (String($event) as OrderStatus),
            )
          "
          ><SelectTrigger id="order-status"><SelectValue /></SelectTrigger
          ><SelectContent
            ><SelectGroup
              ><SelectItem value="all">全部状态</SelectItem
              ><SelectItem
                v-for="(label, value) in statusLabels"
                :key="value"
                :value="value"
                >{{ label }}</SelectItem
              ></SelectGroup
            ></SelectContent
          ></Select
        ></Field
      >
      <Button
        variant="outline"
        :disabled="listStatus === 'loading'"
        @click="
          setStatus(undefined);
          setOrderNo('');
        "
        ><X data-icon="inline-start" />重置</Button
      >
    </FieldGroup>
    <p
      v-if="listStatus === 'error'"
      role="status"
      class="text-sm text-muted-foreground"
    >
      订单列表加载失败，请刷新重试。
    </p>
    <OrderList
      :orders="pageData.items"
      :status="listStatus"
      @view="openOrder"
    />
    <AdminPagination
      :page="query.page"
      :page-size="query.pageSize"
      :total="pageData.total"
      :disabled="listStatus === 'loading'"
      @update:page="goToPage"
    />
    <OrderDetailDialog
      v-model="detailOpen"
      :order="selectedOrder"
      :status="detailStatus"
      :action-status="actionStatus"
      :error="detailError"
      @retry="retryDetail"
      @pay="requestPayment"
      @cancel="requestAction('cancel')"
      @receipt="requestAction('receipt')"
      @return-refund="startReturnRefundApplication"
    />
    <OrderActionDialog
      v-model="actionDialogOpen"
      :action="actionType"
      @confirm="confirmAction"
    />
    <ReturnRefundApplicationsPanel :refresh-key="returnRefundRefresh" />
    <ReturnRefundApplicationDialog
      v-model="returnRefundDialogOpen"
      :order-id="returnRefundOrderId"
      @created="onReturnRefundCreated"
    />
  </section>
</template>
