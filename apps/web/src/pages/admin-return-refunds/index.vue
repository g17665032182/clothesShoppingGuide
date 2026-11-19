<script setup lang="ts">
import { RefreshCw, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import AdminPagination from '@/components/shared/AdminPagination.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import type { ReturnRefundStatus } from '@/api/types/return-refund';
import ReturnRefundDetailDialog from './components/ReturnRefundDetailDialog.vue';
import ReturnRefundTable from './components/ReturnRefundTable.vue';
import {
  adminReturnRefundStatusLabels,
  useAdminReturnRefundsPage,
} from './page';

const {
  actionError,
  actionStatus,
  detailError,
  detailOpen,
  detailStatus,
  goToPage,
  listError,
  listStatus,
  loadApplications,
  openDetail,
  pageData,
  query,
  rejectionReason,
  retryDetail,
  runAction,
  setFilter,
  selected,
} = useAdminReturnRefundsPage();

function applyOrderNo(event: Event): void {
  setFilter(
    'orderNo',
    (event.target as HTMLInputElement).value.trim().slice(0, 100) || undefined,
  );
}

function setStatus(value: string): void {
  setFilter(
    'status',
    value === 'all' ? undefined : (value as ReturnRefundStatus),
  );
}

function setManualReview(value: string): void {
  setFilter(
    'manualReviewRequired',
    value === 'all' ? undefined : value === 'required',
  );
}

function resetFilters(): void {
  setFilter('orderNo', undefined);
  setFilter('status', undefined);
  setFilter('manualReviewRequired', undefined);
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-6 py-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">退货退款审核</h1>
        <p class="text-sm text-muted-foreground">
          {{ pageData.total }} 条申请 · 退款状态仅本站登记
        </p>
      </div>
      <Button
        variant="outline"
        size="icon"
        title="刷新申请"
        aria-label="刷新申请"
        :disabled="listStatus === 'loading'"
        @click="loadApplications"
      >
        <RefreshCw />
      </Button>
    </div>
    <FieldGroup
      class="grid gap-3 md:grid-cols-[minmax(180px,1fr)_180px_180px_auto_auto] md:items-end"
    >
      <Field>
        <FieldLabel for="admin-return-order-no">订单号</FieldLabel>
        <Input
          id="admin-return-order-no"
          :model-value="query.orderNo ?? ''"
          placeholder="精确查询订单号"
          maxlength="100"
          @change="applyOrderNo"
        />
      </Field>
      <Field>
        <FieldLabel for="admin-return-status">申请状态</FieldLabel>
        <Select
          :model-value="query.status ?? 'all'"
          @update:model-value="setStatus(String($event))"
        >
          <SelectTrigger id="admin-return-status"
            ><SelectValue
          /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem
                v-for="(label, value) in adminReturnRefundStatusLabels"
                :key="value"
                :value="value"
              >
                {{ label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel for="admin-return-manual">审核分类</FieldLabel>
        <Select
          :model-value="
            query.manualReviewRequired === undefined
              ? 'all'
              : query.manualReviewRequired
                ? 'required'
                : 'normal'
          "
          @update:model-value="setManualReview(String($event))"
        >
          <SelectTrigger id="admin-return-manual"
            ><SelectValue
          /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部申请</SelectItem>
              <SelectItem value="required">待人工审核</SelectItem>
              <SelectItem value="normal">规则内初筛</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Button
        variant="outline"
        :disabled="listStatus === 'loading'"
        @click="loadApplications"
      >
        应用筛选
      </Button>
      <Button
        variant="ghost"
        :disabled="listStatus === 'loading'"
        @click="resetFilters"
      >
        <X data-icon="inline-start" />重置
      </Button>
    </FieldGroup>
    <Alert v-if="listStatus === 'error'" variant="destructive">
      <AlertDescription role="status">{{ listError }}</AlertDescription>
    </Alert>
    <ReturnRefundTable
      :applications="pageData.items"
      :loading="listStatus === 'loading'"
      :status-labels="adminReturnRefundStatusLabels"
      @view="openDetail"
    />
    <AdminPagination
      :page="query.page"
      :page-size="query.pageSize"
      :total="pageData.total"
      :disabled="listStatus === 'loading'"
      @update:page="goToPage"
    />
    <ReturnRefundDetailDialog
      v-model="detailOpen"
      :application="selected"
      :status="detailStatus"
      :action-status="actionStatus"
      :error="detailError"
      :action-error="actionError"
      :rejection-reason="rejectionReason"
      :status-labels="adminReturnRefundStatusLabels"
      @retry="retryDetail"
      @update:rejection-reason="rejectionReason = $event"
      @action="runAction"
    />
  </section>
</template>
