<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import AdminPagination from '@/components/shared/AdminPagination.vue';
import OrderFilters from './components/OrderFilters.vue';
import OrderTable from './components/OrderTable.vue';
import OrderDetailDialog from './components/OrderDetailDialog.vue';
import ShipOrderDialog from './components/ShipOrderDialog.vue';
import { useAdminOrdersPage } from './page';

const {
  adminOrderStatusLabels,
  detailError,
  detailOpen,
  detailStatus,
  goToPage,
  listStatus,
  loadOrders,
  openShipDialog,
  pageData,
  query,
  selectedOrder,
  resetFilters,
  retryDetail,
  setFilter,
  shipDialogOpen,
  shipError,
  shipStatus,
  submitShipment,
  viewOrder,
} = useAdminOrdersPage();
</script>

<template>
  <section class="flex min-w-0 flex-col gap-6 py-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">订单履约</h1>
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
    <OrderFilters
      :query="query"
      :loading="listStatus === 'loading'"
      :status-labels="adminOrderStatusLabels"
      @update:order-no="setFilter('orderNo', $event)"
      @update:user-id="setFilter('userId', $event)"
      @update:status="setFilter('status', $event)"
      @reset="resetFilters"
    />
    <p
      v-if="listStatus === 'error'"
      role="status"
      class="text-sm text-muted-foreground"
    >
      订单列表加载失败，请刷新重试。
    </p>
    <OrderTable
      :orders="pageData.items"
      :loading="listStatus === 'loading'"
      :status-labels="adminOrderStatusLabels"
      @view="viewOrder"
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
      :loading="detailStatus === 'loading'"
      :error="detailError"
      :status-labels="adminOrderStatusLabels"
      @ship="openShipDialog"
      @retry="retryDetail"
    />
    <ShipOrderDialog
      v-model="shipDialogOpen"
      :order="selectedOrder"
      :submitting="shipStatus === 'submitting'"
      :refreshing="detailStatus === 'loading'"
      :error="shipError"
      @submit="submitShipment"
      @reload="retryDetail"
    />
  </section>
</template>
