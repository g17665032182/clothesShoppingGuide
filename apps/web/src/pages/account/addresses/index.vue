<script setup lang="ts">
import { computed } from 'vue';
import { MapPin, Pencil, Plus, RefreshCw, Star, Trash2 } from '@lucide/vue';
import { toast } from 'vue-sonner';
import AdminPagination from '@/components/shared/AdminPagination.vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import AddressFormDialog from './components/AddressFormDialog.vue';
import { useUserAddressesPage } from './page';

const {
  query,
  pageData,
  listStatus,
  mutationStatus,
  formOpen,
  editingAddress,
  deletingAddress,
  busyAddressId,
  loadAddresses,
  openCreate,
  openEdit,
  closeForm,
  submitAddress,
  requestDelete,
  cancelDelete,
  confirmDelete,
  setDefault,
  goToPage,
} = useUserAddressesPage();

const isDeleting = computed(() => mutationStatus.value === 'submitting');
const deleteResultUnknown = computed(
  () => mutationStatus.value === 'unknown' && Boolean(deletingAddress.value),
);

function copiedAddress(address: string): void {
  void navigator.clipboard
    .writeText(address)
    .then(() => toast.success('地址已复制'))
    .catch(() => toast.error('复制失败，请手动选择地址'));
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-6 py-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">收货地址</h1>
        <p class="text-sm text-muted-foreground">
          管理本人常用地址，共 {{ pageData.total }} 条
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          title="刷新地址"
          aria-label="刷新地址"
          :disabled="listStatus === 'loading'"
          @click="loadAddresses"
        >
          <RefreshCw />
        </Button>
        <Button
          :disabled="
            mutationStatus === 'submitting' || mutationStatus === 'unknown'
          "
          @click="openCreate"
        >
          <Plus data-icon="inline-start" />
          新增地址
        </Button>
      </div>
    </div>

    <Alert v-if="listStatus === 'error'" variant="destructive">
      <AlertTitle>地址列表加载失败</AlertTitle>
      <AlertDescription
        class="flex flex-wrap items-center justify-between gap-3"
      >
        <span>请检查网络后重试。</span>
        <Button variant="outline" size="sm" @click="loadAddresses">
          <RefreshCw data-icon="inline-start" />
          重试
        </Button>
      </AlertDescription>
    </Alert>

    <div
      v-if="listStatus === 'loading' && pageData.items.length === 0"
      class="grid gap-3 md:grid-cols-2"
      aria-label="正在加载地址"
    >
      <Skeleton v-for="index in 4" :key="index" class="h-48" />
    </div>

    <Empty v-else-if="listStatus === 'empty'">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MapPin /></EmptyMedia>
        <EmptyTitle>还没有收货地址</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button @click="openCreate">
          <Plus data-icon="inline-start" />
          新增地址
        </Button>
      </EmptyContent>
    </Empty>

    <div
      v-else-if="pageData.items.length > 0"
      class="grid min-w-0 gap-3 md:grid-cols-2"
    >
      <Card v-for="address in pageData.items" :key="address.id" class="min-w-0">
        <CardHeader class="flex-row items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <CardTitle class="break-words text-base">
                {{ address.recipientName }}
              </CardTitle>
              <Badge v-if="address.label" variant="secondary">
                {{ address.label }}
              </Badge>
              <Badge v-if="address.isDefault">默认</Badge>
            </div>
            <p class="text-sm text-muted-foreground">{{ address.phone }}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="复制地址"
            aria-label="复制地址"
            @click="copiedAddress(address.address)"
          >
            <MapPin />
          </Button>
        </CardHeader>
        <CardContent>
          <p class="break-words text-sm leading-6">{{ address.address }}</p>
        </CardContent>
        <CardFooter class="flex flex-wrap justify-end gap-2">
          <Button
            v-if="!address.isDefault"
            variant="outline"
            size="sm"
            :disabled="mutationStatus === 'submitting'"
            @click="setDefault(address)"
          >
            <Star data-icon="inline-start" />
            设为默认
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="mutationStatus === 'submitting'"
            @click="openEdit(address)"
          >
            <Pencil data-icon="inline-start" />
            编辑
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="mutationStatus === 'submitting'"
            @click="requestDelete(address)"
          >
            <Trash2 data-icon="inline-start" />
            删除
          </Button>
        </CardFooter>
      </Card>
    </div>

    <AdminPagination
      v-if="pageData.total > query.pageSize"
      :page="query.page"
      :page-size="query.pageSize"
      :total="pageData.total"
      :disabled="listStatus === 'loading'"
      @update:page="goToPage"
    />

    <AddressFormDialog
      :model-value="formOpen"
      :address="editingAddress"
      :submitting="mutationStatus === 'submitting'"
      :result-unknown="mutationStatus === 'unknown'"
      @update:model-value="closeForm"
      @submit="submitAddress"
    />

    <AlertDialog
      :open="Boolean(deletingAddress)"
      @update:open="(open) => !open && cancelDelete()"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除这个收货地址？</AlertDialogTitle>
          <AlertDialogDescription>
            {{ deletingAddress?.recipientName }}
            的地址将从地址簿移除。已创建的订单收货信息不受影响。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            :disabled="isDeleting || deleteResultUnknown"
            @click="cancelDelete"
          >
            返回
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="isDeleting"
            @click.prevent="confirmDelete"
          >
            <RefreshCw v-if="deleteResultUnknown" data-icon="inline-start" />
            <Trash2 v-else data-icon="inline-start" />
            {{ deleteResultUnknown ? '重试删除' : '确认删除' }}
          </AlertDialogAction>
        </AlertDialogFooter>
        <p
          v-if="busyAddressId === deletingAddress?.id && isDeleting"
          class="text-sm text-muted-foreground"
          role="status"
        >
          正在处理…
        </p>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
