<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Download, RotateCcw, Trash2, Upload, X } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { ApiError } from '@/api';
import {
  cancelReturnRefundApplication,
  deleteReturnRefundEvidence,
  downloadReturnRefundEvidence,
  getReturnRefundApplication,
  listReturnRefundApplications,
  submitReturnRefundDraft,
  submitReturnRefundShipment,
  uploadReturnRefundEvidence,
} from '@/api/modules/return-refund';
import type {
  ReturnRefundApplication,
  ReturnRefundApplicationPage,
  ReturnRefundApplicationSummary,
  ReturnRefundEvidence,
  ReturnRefundShipmentPayload,
  ReturnRefundStatus,
} from '@/api/types/return-refund';
import AdminPagination from '@/components/shared/AdminPagination.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { auth } from '@/lib/auth';

const props = defineProps<{ refreshKey?: number }>();

type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';
type DetailStatus = AsyncStatus | 'unknown';
type ActionStatus = 'idle' | 'submitting' | 'unknown' | 'error';

const statusLabels: Record<ReturnRefundStatus, string> = {
  pending_user_submission: '待你提交',
  pending_review: '待审核',
  approved_pending_return: '待寄回',
  returned_by_user: '已寄回',
  pending_inspection: '待验货',
  refund_processing: '退款处理中',
  refunded: '本站已登记退款完成',
  rejected: '已拒绝',
  cancelled: '已取消',
};
const MAX_EVIDENCE_COUNT = 5;
const IMAGE_EVIDENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const pageData = ref<ReturnRefundApplicationPage>({
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
});
const page = ref(1);
const listStatus = ref<AsyncStatus>('idle');
const listError = ref('');
const detailStatus = ref<DetailStatus>('idle');
const detailError = ref('');
const selected = ref<ReturnRefundApplication | null>(null);
const selectedId = ref<string | null>(null);
const detailOpen = ref(false);
const actionStatus = ref<ActionStatus>('idle');
const actionError = ref('');
const cancelConfirmOpen = ref(false);
const carrier = ref('');
const trackingNo = ref('');
const shipmentError = ref('');
const evidenceError = ref('');
const evidenceBusy = ref(false);
const evidenceInput = ref<HTMLInputElement | null>(null);
const evidenceToDelete = ref<ReturnRefundEvidence | null>(null);
const evidenceDeleteOpen = ref(false);
const evidencePreview = ref<{
  id: string;
  url: string;
  mediaType: ReturnRefundEvidence['mediaType'];
} | null>(null);
let evidenceController: AbortController | null = null;
const canManageEvidence = computed(
  () =>
    selected.value !== null &&
    ['pending_user_submission', 'pending_review'].includes(
      selected.value.status,
    ),
);
const canUploadEvidence = computed(
  () =>
    canManageEvidence.value &&
    (selected.value?.evidence.length ?? 0) < MAX_EVIDENCE_COUNT &&
    !evidenceBusy.value,
);
const evidencePreviewFileName = computed(() => {
  const evidence = selected.value?.evidence.find(
    (item) => item.id === evidencePreview.value?.id,
  );
  return evidence ? evidenceFilename(evidence) : '申请附件';
});
const totalPages = computed(() =>
  Math.max(1, Math.ceil(pageData.value.total / pageData.value.pageSize)),
);
const canCancel = computed(
  () =>
    selected.value !== null &&
    ['pending_user_submission', 'pending_review'].includes(
      selected.value.status,
    ),
);
const canSubmitDraft = computed(
  () => selected.value?.status === 'pending_user_submission',
);
const canSubmitShipment = computed(
  () =>
    selected.value?.status === 'approved_pending_return' &&
    carrier.value.trim().length > 0 &&
    trackingNo.value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f]/u.test(carrier.value + trackingNo.value),
);
let listController: AbortController | null = null;
let detailController: AbortController | null = null;
let actionController: AbortController | null = null;
let listVersion = 0;
let detailVersion = 0;
let identityVersion = 0;
let disposed = false;

function currentIdentity(version: number, userId: string | undefined): boolean {
  return (
    !disposed &&
    version === identityVersion &&
    userId === (auth.state.token ? auth.state.user?.id : undefined)
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function evidenceMediaType(
  file: File,
): ReturnRefundEvidence['mediaType'] | null {
  const supported = new Set([...IMAGE_EVIDENCE_TYPES, 'video/mp4']);
  if (supported.has(file.type))
    return file.type as ReturnRefundEvidence['mediaType'];
  if (file.type) return null;
  const extension = file.name.split('.').pop()?.toLowerCase();
  const types: Record<string, ReturnRefundEvidence['mediaType']> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
  };
  return extension ? (types[extension] ?? null) : null;
}

function evidenceFileError(file: File): string {
  const mediaType = evidenceMediaType(file);
  if (!mediaType) return '仅支持 JPG、PNG、WebP 图片或 MP4 视频。';
  const maxBytes = IMAGE_EVIDENCE_TYPES.has(mediaType)
    ? MAX_IMAGE_BYTES
    : MAX_VIDEO_BYTES;
  if (file.size <= 0) return '文件不能为空。';
  if (file.size > maxBytes)
    return IMAGE_EVIDENCE_TYPES.has(mediaType)
      ? '图片大小不能超过 10 MiB。'
      : 'MP4 视频大小不能超过 50 MiB。';
  return '';
}

function clearEvidencePreview(): void {
  if (evidencePreview.value) URL.revokeObjectURL(evidencePreview.value.url);
  evidencePreview.value = null;
}

function evidenceFilename(evidence: ReturnRefundEvidence): string {
  const extensions: Record<ReturnRefundEvidence['mediaType'], string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
  };
  return `售后凭证-${evidence.id}.${extensions[evidence.mediaType]}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function loadApplications(): Promise<void> {
  const token = auth.state.token;
  if (!token) return;
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  const requestVersion = ++listVersion;
  const identity = identityVersion;
  const userId = auth.state.user?.id;
  listStatus.value = 'loading';
  listError.value = '';
  try {
    const result = await listReturnRefundApplications(
      token,
      { page: page.value, pageSize: 20 },
      controller.signal,
    );
    if (
      controller.signal.aborted ||
      requestVersion !== listVersion ||
      !currentIdentity(identity, userId)
    )
      return;
    pageData.value = result;
    listStatus.value = result.items.length ? 'success' : 'empty';
  } catch (error) {
    if (
      !controller.signal.aborted &&
      requestVersion === listVersion &&
      currentIdentity(identity, userId) &&
      !isAbort(error)
    ) {
      listStatus.value = 'error';
      listError.value =
        error instanceof Error ? error.message : '申请列表读取失败。';
    }
  }
}

async function openDetail(
  application: ReturnRefundApplicationSummary | string,
): Promise<void> {
  const token = auth.state.token;
  const id = typeof application === 'string' ? application : application.id;
  if (!token || actionStatus.value === 'submitting') return;
  detailController?.abort();
  const controller = new AbortController();
  detailController = controller;
  const requestVersion = ++detailVersion;
  const identity = identityVersion;
  const userId = auth.state.user?.id;
  selectedId.value = id;
  clearEvidencePreview();
  evidenceError.value = '';
  detailOpen.value = true;
  detailStatus.value = 'loading';
  detailError.value = '';
  actionStatus.value = 'idle';
  actionError.value = '';
  carrier.value = '';
  trackingNo.value = '';
  try {
    const result = await getReturnRefundApplication(
      token,
      id,
      controller.signal,
    );
    if (
      controller.signal.aborted ||
      requestVersion !== detailVersion ||
      !currentIdentity(identity, userId)
    )
      return;
    selected.value = result;
    detailStatus.value = 'success';
  } catch (error) {
    if (
      !controller.signal.aborted &&
      requestVersion === detailVersion &&
      currentIdentity(identity, userId) &&
      !isAbort(error)
    ) {
      detailStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      detailError.value =
        error instanceof Error ? error.message : '申请详情读取失败。';
    }
  }
}

async function uploadEvidence(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const current = selected.value;
  const token = auth.state.token;
  if (!file || !current || !token || !canUploadEvidence.value) return;
  evidenceError.value = evidenceFileError(file);
  if (evidenceError.value) return;

  const identity = identityVersion;
  const userId = auth.state.user?.id;
  const controller = new AbortController();
  evidenceController?.abort();
  evidenceController = controller;
  evidenceBusy.value = true;
  evidenceError.value = '';
  try {
    await uploadReturnRefundEvidence(
      token,
      current.id,
      file,
      controller.signal,
    );
    if (!currentIdentity(identity, userId)) return;
    toast.success('凭证已上传');
    await openDetail(current.id);
    await loadApplications();
  } catch (error) {
    if (
      !controller.signal.aborted &&
      currentIdentity(identity, userId) &&
      !isAbort(error)
    ) {
      evidenceError.value =
        error instanceof Error ? error.message : '凭证上传失败。';
    }
  } finally {
    if (evidenceController === controller) evidenceController = null;
    evidenceBusy.value = false;
  }
}

async function downloadEvidence(evidence: ReturnRefundEvidence): Promise<void> {
  const current = selected.value;
  const token = auth.state.token;
  if (!current || !token || evidenceBusy.value) return;
  const identity = identityVersion;
  const userId = auth.state.user?.id;
  const controller = new AbortController();
  evidenceController?.abort();
  evidenceController = controller;
  evidenceBusy.value = true;
  evidenceError.value = '';
  try {
    const blob = await downloadReturnRefundEvidence(
      token,
      current.id,
      evidence.id,
      controller.signal,
    );
    if (!currentIdentity(identity, userId)) return;
    clearEvidencePreview();
    evidencePreview.value = {
      id: evidence.id,
      url: URL.createObjectURL(blob),
      mediaType: evidence.mediaType,
    };
  } catch (error) {
    if (
      !controller.signal.aborted &&
      currentIdentity(identity, userId) &&
      !isAbort(error)
    ) {
      evidenceError.value =
        error instanceof Error ? error.message : '凭证读取失败。';
    }
  } finally {
    if (evidenceController === controller) evidenceController = null;
    evidenceBusy.value = false;
  }
}

async function deleteEvidence(): Promise<void> {
  const current = selected.value;
  const evidence = evidenceToDelete.value;
  const token = auth.state.token;
  if (!current || !evidence || !token || evidenceBusy.value) return;
  const identity = identityVersion;
  const userId = auth.state.user?.id;
  const controller = new AbortController();
  evidenceController?.abort();
  evidenceController = controller;
  evidenceBusy.value = true;
  evidenceError.value = '';
  try {
    await deleteReturnRefundEvidence(
      token,
      current.id,
      evidence.id,
      controller.signal,
    );
    if (!currentIdentity(identity, userId)) return;
    evidenceDeleteOpen.value = false;
    evidenceToDelete.value = null;
    clearEvidencePreview();
    toast.success('凭证已删除');
    await openDetail(current.id);
    await loadApplications();
  } catch (error) {
    if (
      !controller.signal.aborted &&
      currentIdentity(identity, userId) &&
      !isAbort(error)
    ) {
      evidenceError.value =
        error instanceof Error ? error.message : '凭证删除失败。';
    }
  } finally {
    if (evidenceController === controller) evidenceController = null;
    evidenceBusy.value = false;
  }
}

async function runAction(
  action: 'submit' | 'cancel' | 'shipment',
): Promise<void> {
  const token = auth.state.token;
  const current = selected.value;
  if (!token || !current || actionStatus.value === 'submitting') return;
  const identity = identityVersion;
  const userId = auth.state.user?.id;
  const controller = new AbortController();
  actionController?.abort();
  actionController = controller;
  actionStatus.value = 'submitting';
  actionError.value = '';
  try {
    const result =
      action === 'submit'
        ? await submitReturnRefundDraft(
            token,
            current.id,
            current.version,
            controller.signal,
          )
        : action === 'cancel'
          ? await cancelReturnRefundApplication(
              token,
              current.id,
              controller.signal,
            )
          : await submitReturnRefundShipment(
              token,
              current.id,
              {
                carrier: carrier.value.trim(),
                trackingNo: trackingNo.value.trim(),
                version: current.version,
              } satisfies ReturnRefundShipmentPayload,
              controller.signal,
            );
    if (!currentIdentity(identity, userId)) return;
    selected.value = result;
    actionStatus.value = 'idle';
    cancelConfirmOpen.value = false;
    shipmentError.value = '';
    toast.success(
      action === 'submit'
        ? '申请已提交，等待管理员审核'
        : action === 'cancel'
          ? '申请已取消'
          : '退货物流已登记',
    );
    await loadApplications();
  } catch (error) {
    if (!currentIdentity(identity, userId)) return;
    actionStatus.value =
      error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
    actionError.value =
      error instanceof Error ? error.message : '操作失败，请重新读取后重试。';
    if (actionStatus.value === 'unknown') await openDetail(current.id);
  } finally {
    if (actionController === controller) actionController = null;
  }
}

function submitShipment(): void {
  shipmentError.value = '';
  if (!canSubmitShipment.value) {
    shipmentError.value = '请填写有效的承运商和物流单号。';
    return;
  }
  void runAction('shipment');
}

function retryDetail(): void {
  if (selectedId.value) void openDetail(selectedId.value);
}

watch(
  () => (auth.state.token ? auth.state.user?.id : null),
  () => {
    identityVersion += 1;
    listVersion += 1;
    detailVersion += 1;
    listController?.abort();
    detailController?.abort();
    actionController?.abort();
    evidenceController?.abort();
    listController = null;
    detailController = null;
    actionController = null;
    evidenceController = null;
    evidenceBusy.value = false;
    evidenceError.value = '';
    evidenceDeleteOpen.value = false;
    evidenceToDelete.value = null;
    clearEvidencePreview();
    pageData.value = { items: [], total: 0, page: 1, pageSize: 20 };
    selected.value = null;
    selectedId.value = null;
    detailOpen.value = false;
    listStatus.value = 'idle';
    detailStatus.value = 'idle';
    actionStatus.value = 'idle';
    if (auth.state.token) void loadApplications();
  },
  { flush: 'sync' },
);

function setPage(nextPage: number): void {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value)
    return;
  page.value = nextPage;
  void loadApplications();
}

watch(detailOpen, (open) => {
  if (!open) clearEvidencePreview();
});

onMounted(() => void loadApplications());
watch(
  () => props.refreshKey,
  () => void loadApplications(),
);
onBeforeUnmount(() => {
  disposed = true;
  listController?.abort();
  detailController?.abort();
  actionController?.abort();
  evidenceController?.abort();
  clearEvidencePreview();
});
</script>

<template>
  <section class="flex min-w-0 flex-col gap-4 border-t pt-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">退货退款申请</h2>
        <p class="text-sm text-muted-foreground">{{ pageData.total }} 条申请</p>
      </div>
      <Button
        variant="outline"
        size="icon"
        title="刷新售后申请"
        aria-label="刷新售后申请"
        :disabled="listStatus === 'loading'"
        @click="loadApplications"
      >
        <Spinner v-if="listStatus === 'loading'" />
        <RotateCcw v-else />
      </Button>
    </div>
    <Alert v-if="listStatus === 'error'" variant="destructive">
      <AlertDescription role="status">{{ listError }}</AlertDescription>
    </Alert>
    <div class="overflow-x-auto rounded-md border">
      <Table class="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead>订单号</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>申请金额</TableHead>
            <TableHead>商品数</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead class="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="listStatus === 'loading'">
            <TableRow v-for="row in 3" :key="row">
              <TableCell v-for="cell in 6" :key="cell">
                <Skeleton class="h-5 w-full" />
              </TableCell>
            </TableRow>
          </template>
          <TableRow v-else-if="pageData.items.length === 0">
            <TableCell :colspan="6">
              <Empty class="border-0 py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><span>退</span></EmptyMedia>
                  <EmptyTitle>暂无退货退款申请</EmptyTitle>
                </EmptyHeader>
              </Empty>
            </TableCell>
          </TableRow>
          <template v-else>
            <TableRow
              v-for="application in pageData.items"
              :key="application.id"
            >
              <TableCell class="max-w-52 break-all font-medium">
                {{ application.orderNo }}
                <p
                  v-if="application.manualReviewRequired"
                  class="mt-1 text-xs text-muted-foreground"
                >
                  待人工审核
                </p>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{{
                  statusLabels[application.status]
                }}</Badge>
              </TableCell>
              <TableCell
                >{{ application.currency }}
                {{ application.refundAmount }}</TableCell
              >
              <TableCell>{{ application.itemCount }}</TableCell>
              <TableCell>{{ formatDate(application.createdAt) }}</TableCell>
              <TableCell class="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="actionStatus === 'submitting'"
                  @click="openDetail(application)"
                >
                  查看
                </Button>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>
    <AdminPagination
      :page="pageData.page"
      :page-size="pageData.pageSize"
      :total="pageData.total"
      :disabled="listStatus === 'loading'"
      @update:page="setPage"
    />
  </section>

  <Dialog :open="detailOpen" @update:open="detailOpen = $event">
    <DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>申请详情</DialogTitle>
        <DialogDescription class="break-all">
          {{ selected?.orderNo ?? '正在读取申请' }}
        </DialogDescription>
      </DialogHeader>
      <div v-if="detailStatus === 'loading'" class="flex flex-col gap-3">
        <Skeleton class="h-8 w-1/2" />
        <Skeleton class="h-24 w-full" />
      </div>
      <div
        v-else-if="detailError || detailStatus === 'unknown'"
        class="flex flex-col items-start gap-3"
      >
        <Alert variant="destructive">
          <AlertDescription role="status">
            {{ detailError || '读取结果未确认，请重新读取。' }}
          </AlertDescription>
        </Alert>
        <Button variant="outline" @click="retryDetail">重新读取</Button>
      </div>
      <template v-else-if="selected">
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{{ statusLabels[selected.status] }}</Badge>
          <Badge v-if="selected.manualReviewRequired" variant="secondary"
            >待人工审核</Badge
          >
          <span class="text-sm font-medium">
            {{ selected.currency }} {{ selected.refundAmount }}
          </span>
        </div>
        <Alert v-if="selected.manualReviewRequired">
          <AlertDescription>
            此申请需要人工审核，不代表一定符合退货退款条件。
          </AlertDescription>
        </Alert>
        <div class="flex flex-col gap-3 border-y py-4">
          <h3 class="text-sm font-semibold">申请商品</h3>
          <div
            v-for="item in selected.items"
            :key="item.orderItemId"
            class="flex min-w-0 flex-wrap justify-between gap-2 text-sm"
          >
            <span class="min-w-0 break-words">
              {{ item.productName }} · {{ item.color }} / {{ item.size }} ×
              {{ item.quantity }}
            </span>
            <span class="shrink-0"
              >{{ selected.currency }} {{ item.lineAmount }}</span
            >
          </div>
        </div>
        <div class="flex flex-col gap-1 text-sm">
          <h3 class="font-semibold">退货原因</h3>
          <p class="whitespace-pre-wrap break-words text-muted-foreground">
            {{ selected.reason }}
          </p>
        </div>
        <dl class="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted-foreground">申请时间</dt>
            <dd>{{ formatDate(selected.createdAt) }}</dd>
          </div>
          <div v-if="selected.submittedAt">
            <dt class="text-muted-foreground">提交时间</dt>
            <dd>{{ formatDate(selected.submittedAt) }}</dd>
          </div>
          <div v-if="selected.returnCarrier">
            <dt class="text-muted-foreground">退货承运商</dt>
            <dd>{{ selected.returnCarrier }}</dd>
          </div>
          <div v-if="selected.returnTrackingNo">
            <dt class="text-muted-foreground">退货单号</dt>
            <dd class="break-all">{{ selected.returnTrackingNo }}</dd>
          </div>
          <div v-if="selected.rejectionReason" class="sm:col-span-2">
            <dt class="text-muted-foreground">拒绝原因</dt>
            <dd class="break-words">{{ selected.rejectionReason }}</dd>
          </div>
        </dl>
        <section class="flex flex-col gap-3 border-t pt-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 class="text-sm font-semibold">
                凭证（{{ selected.evidence.length }} /
                {{ MAX_EVIDENCE_COUNT }}）
              </h3>
              <p class="text-xs text-muted-foreground">
                JPG、PNG、WebP 图片每份不超过 10 MiB；MP4 视频每份不超过 50
                MiB。
              </p>
            </div>
            <Button
              v-if="canUploadEvidence"
              variant="outline"
              size="sm"
              :disabled="evidenceBusy"
              @click="evidenceInput?.click()"
            >
              <Spinner v-if="evidenceBusy" data-icon="inline-start" />
              <Upload v-else data-icon="inline-start" />
              添加凭证
            </Button>
            <input
              ref="evidenceInput"
              class="sr-only"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4"
              :disabled="!canUploadEvidence"
              @change="uploadEvidence"
            />
          </div>
          <p v-if="!canManageEvidence" class="text-xs text-muted-foreground">
            当前申请状态不允许上传或删除凭证。
          </p>
          <p
            v-else-if="selected.evidence.length >= MAX_EVIDENCE_COUNT"
            class="text-xs text-muted-foreground"
          >
            每笔申请最多上传 5 份凭证。
          </p>
          <div
            v-for="evidence in selected.evidence"
            :key="evidence.id"
            class="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-b-0"
          >
            <span class="min-w-0 break-all">
              {{ evidenceFilename(evidence) }}
              <span class="ml-2 text-xs text-muted-foreground">
                {{ (evidence.byteSize / 1024 / 1024).toFixed(1) }} MiB
              </span>
            </span>
            <div class="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="evidenceBusy"
                @click="downloadEvidence(evidence)"
              >
                <Download data-icon="inline-start" />查看
              </Button>
              <Button
                v-if="canManageEvidence"
                variant="ghost"
                size="icon"
                title="删除凭证"
                aria-label="删除凭证"
                :disabled="evidenceBusy"
                @click="
                  evidenceToDelete = evidence;
                  evidenceDeleteOpen = true;
                "
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <Alert v-if="evidenceError" variant="destructive">
            <AlertDescription role="alert">{{
              evidenceError
            }}</AlertDescription>
          </Alert>
          <div
            v-if="evidencePreview"
            class="flex min-w-0 flex-col gap-2 border-t pt-3"
          >
            <div class="flex items-center justify-between gap-2">
              <h4 class="break-all text-sm font-medium">
                {{ evidencePreviewFileName }}
              </h4>
              <Button
                variant="ghost"
                size="icon"
                title="关闭预览"
                aria-label="关闭预览"
                @click="clearEvidencePreview"
              >
                <X />
              </Button>
            </div>
            <img
              v-if="evidencePreview.mediaType.startsWith('image/')"
              :src="evidencePreview.url"
              alt="退货退款申请凭证"
              class="max-h-[55dvh] w-full rounded-md border object-contain"
            />
            <video
              v-else
              :src="evidencePreview.url"
              controls
              playsinline
              class="max-h-[55dvh] w-full rounded-md border"
            />
            <a
              class="text-sm underline underline-offset-4"
              :href="evidencePreview.url"
              :download="evidencePreviewFileName"
            >
              下载凭证
            </a>
          </div>
        </section>
        <FieldGroup
          v-if="selected.status === 'approved_pending_return'"
          class="grid gap-3 border-t pt-4"
        >
          <h3 class="text-sm font-semibold">登记退货物流</h3>
          <Field>
            <FieldLabel for="return-carrier">承运商</FieldLabel>
            <Input
              id="return-carrier"
              v-model="carrier"
              maxlength="100"
              :disabled="actionStatus === 'submitting'"
            />
          </Field>
          <Field>
            <FieldLabel for="return-tracking-no">物流单号</FieldLabel>
            <Input
              id="return-tracking-no"
              v-model="trackingNo"
              maxlength="100"
              :disabled="actionStatus === 'submitting'"
            />
          </Field>
          <Alert v-if="shipmentError || actionError" variant="destructive">
            <AlertDescription role="alert">{{
              shipmentError || actionError
            }}</AlertDescription>
          </Alert>
          <Button
            :disabled="!canSubmitShipment || actionStatus === 'submitting'"
            @click="submitShipment"
          >
            <Spinner
              v-if="actionStatus === 'submitting'"
              data-icon="inline-start"
            />
            登记已寄回
          </Button>
        </FieldGroup>
        <Alert
          v-else-if="
            selected.status === 'pending_inspection' ||
            selected.status === 'refund_processing'
          "
        >
          <AlertDescription>
            退款状态由本站管理员更新；订单使用的是模拟支付，不会实际退回资金。
          </AlertDescription>
        </Alert>
        <Alert v-else-if="selected.status === 'refunded'">
          <AlertDescription>
            本站已登记退款完成。该订单使用模拟支付，此状态不代表真实资金渠道退款。
          </AlertDescription>
        </Alert>
        <Alert
          v-if="actionError && selected.status !== 'approved_pending_return'"
          variant="destructive"
        >
          <AlertDescription role="alert">{{ actionError }}</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button
            v-if="canCancel"
            type="button"
            variant="outline"
            :disabled="actionStatus === 'submitting'"
            @click="cancelConfirmOpen = true"
          >
            取消申请
          </Button>
          <Button
            v-if="canSubmitDraft"
            :disabled="actionStatus === 'submitting'"
            @click="runAction('submit')"
          >
            <Spinner
              v-if="actionStatus === 'submitting'"
              data-icon="inline-start"
            />
            确认并提交审核
          </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>

  <AlertDialog v-model:open="cancelConfirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>取消这笔售后申请？</AlertDialogTitle>
        <AlertDialogDescription>
          取消后该申请结束；需要时可以重新申请。此操作不会执行退款。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="actionStatus === 'submitting'"
          >返回</AlertDialogCancel
        >
        <AlertDialogAction
          :disabled="actionStatus === 'submitting'"
          @click="runAction('cancel')"
        >
          确认取消申请
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <AlertDialog v-model:open="evidenceDeleteOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>删除这份凭证？</AlertDialogTitle>
        <AlertDialogDescription>
          删除后管理员将无法使用这份凭证审核申请。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="evidenceBusy">返回</AlertDialogCancel>
        <AlertDialogAction
          :disabled="evidenceBusy || !evidenceToDelete"
          @click="deleteEvidence"
        >
          <Spinner v-if="evidenceBusy" data-icon="inline-start" />
          确认删除
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
