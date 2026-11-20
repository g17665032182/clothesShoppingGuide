<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Download, X } from '@lucide/vue';
import { ApiError } from '@/api';
import { downloadAdminReturnRefundEvidence } from '@/api/modules/admin-return-refunds';
import type { AdminReturnRefundApplication } from '@/api/types/admin-return-refunds';
import type {
  ReturnRefundEvidence,
  ReturnRefundStatus,
} from '@/api/types/return-refund';
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { auth } from '@/lib/auth';

const props = defineProps<{
  modelValue: boolean;
  application: AdminReturnRefundApplication | null;
  status: 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'unknown';
  actionStatus: 'idle' | 'submitting' | 'unknown' | 'error';
  error: string;
  actionError: string;
  rejectionReason: string;
  statusLabels: Record<ReturnRefundStatus, string>;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  retry: [];
  'update:rejectionReason': [value: string];
  action: [
    action:
      'approve' | 'reject' | 'received' | 'refund-processing' | 'refunded',
  ];
}>();
const confirmRefundOpen = ref(false);
const evidenceBusyId = ref<string | null>(null);
const evidenceError = ref('');
const evidencePreview = ref<{
  id: string;
  url: string;
  mediaType: ReturnRefundEvidence['mediaType'];
} | null>(null);
let evidenceController: AbortController | null = null;
const canApprove = computed(
  () =>
    props.status === 'success' &&
    props.application?.status === 'pending_review',
);
const canReceive = computed(
  () =>
    props.status === 'success' &&
    props.application?.status === 'returned_by_user',
);
const canStartRefund = computed(
  () =>
    props.status === 'success' &&
    props.application?.status === 'pending_inspection',
);
const canCompleteRefund = computed(
  () =>
    props.status === 'success' &&
    props.application?.status === 'refund_processing',
);
const evidencePreviewFileName = computed(() => {
  const evidence = props.application?.evidence.find(
    (item) => item.id === evidencePreview.value?.id,
  );
  return evidence ? evidenceFilename(evidence) : '售后凭证';
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      confirmRefundOpen.value = false;
      clearEvidencePreview();
    }
  },
);

watch(
  () => props.application?.id,
  () => {
    clearEvidencePreview();
    evidenceError.value = '';
    evidenceController?.abort();
    evidenceController = null;
    evidenceBusyId.value = null;
  },
);

function formatDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '-';
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

async function downloadEvidence(evidence: ReturnRefundEvidence): Promise<void> {
  const token = auth.state.token;
  const applicationId = props.application?.id;
  if (!token || !applicationId || evidenceBusyId.value) return;
  const controller = new AbortController();
  evidenceController?.abort();
  evidenceController = controller;
  evidenceBusyId.value = evidence.id;
  evidenceError.value = '';
  try {
    const blob = await downloadAdminReturnRefundEvidence(
      token,
      applicationId,
      evidence.id,
      controller.signal,
    );
    if (controller.signal.aborted || props.application?.id !== applicationId)
      return;
    clearEvidencePreview();
    evidencePreview.value = {
      id: evidence.id,
      url: URL.createObjectURL(blob),
      mediaType: evidence.mediaType,
    };
  } catch (error) {
    if (!controller.signal.aborted)
      evidenceError.value =
        error instanceof ApiError ? error.message : '凭证读取失败。';
  } finally {
    if (evidenceController === controller) evidenceController = null;
    evidenceBusyId.value = null;
  }
}

onBeforeUnmount(() => {
  evidenceController?.abort();
  clearEvidencePreview();
});
</script>

<template>
  <Dialog :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>退货退款审核</DialogTitle>
        <DialogDescription class="break-all">
          {{ application?.orderNo ?? '正在读取申请' }}
        </DialogDescription>
      </DialogHeader>
      <div v-if="status === 'loading'" class="flex flex-col gap-3">
        <Skeleton class="h-8 w-1/2" />
        <Skeleton class="h-32 w-full" />
      </div>
      <div
        v-else-if="error || status === 'unknown'"
        class="flex flex-col items-start gap-3"
      >
        <Alert variant="destructive">
          <AlertDescription role="status">
            {{ error || '读取结果未确认，请重新读取。' }}
          </AlertDescription>
        </Alert>
        <Button variant="outline" @click="emit('retry')">重新读取</Button>
      </div>
      <template v-else-if="application">
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{{
            statusLabels[application.status]
          }}</Badge>
          <Badge v-if="application.manualReviewRequired" variant="secondary">
            待人工审核
          </Badge>
          <span class="text-sm font-semibold">
            {{ application.currency }} {{ application.refundAmount }}
          </span>
        </div>
        <Alert v-if="application.manualReviewRequired">
          <AlertDescription>
            规则初筛未通过或状态无法判定，请人工核验；系统未自动拒绝。
          </AlertDescription>
        </Alert>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted-foreground">申请人 ID</dt>
            <dd class="break-all">{{ application.userId }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">创建时间</dt>
            <dd>{{ formatDate(application.createdAt) }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">提交时间</dt>
            <dd>{{ formatDate(application.submittedAt) }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">批准时间</dt>
            <dd>{{ formatDate(application.approvedAt) }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">退货承运商</dt>
            <dd>{{ application.returnCarrier ?? '-' }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">退货单号</dt>
            <dd class="break-all">{{ application.returnTrackingNo ?? '-' }}</dd>
          </div>
        </dl>
        <section class="flex flex-col gap-3 border-y py-4">
          <h3 class="text-sm font-semibold">申请商品</h3>
          <div
            v-for="item in application.items"
            :key="item.orderItemId"
            class="flex min-w-0 flex-wrap justify-between gap-2 text-sm"
          >
            <span class="min-w-0 wrap-break-word">
              {{ item.productName }} · {{ item.color }} / {{ item.size }} ×
              {{ item.quantity }}
            </span>
            <span class="shrink-0"
              >{{ application.currency }} {{ item.lineAmount }}</span
            >
          </div>
        </section>
        <section class="flex flex-col gap-1 text-sm">
          <h3 class="font-semibold">用户原因</h3>
          <p class="whitespace-pre-wrap wrap-break-word text-muted-foreground">
            {{ application.reason }}
          </p>
        </section>
        <section class="flex flex-col gap-3 border-t pt-4">
          <div>
            <h3 class="text-sm font-semibold">
              用户凭证（{{ application.evidence.length }}）
            </h3>
            <p class="text-xs text-muted-foreground">
              文件经登录态接口读取，不公开附件地址。
            </p>
          </div>
          <div
            v-for="evidence in application.evidence"
            :key="evidence.id"
            class="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-b-0"
          >
            <span class="min-w-0 break-all">
              {{ evidenceFilename(evidence) }}
              <span class="ml-2 text-xs text-muted-foreground">
                {{ (evidence.byteSize / 1024 / 1024).toFixed(1) }} MiB
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              :disabled="evidenceBusyId !== null"
              @click="downloadEvidence(evidence)"
            >
              <Spinner
                v-if="evidenceBusyId === evidence.id"
                data-icon="inline-start"
              />
              <Download v-else data-icon="inline-start" />
              预览
            </Button>
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
              alt="售后申请凭证"
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
        <FieldGroup v-if="canApprove" class="grid gap-3 border-t pt-4">
          <Field>
            <FieldLabel for="return-refund-rejection-reason"
              >拒绝原因</FieldLabel
            >
            <Textarea
              id="return-refund-rejection-reason"
              :model-value="rejectionReason"
              maxlength="1000"
              rows="3"
              placeholder="填写拒绝理由；通过时留空"
              :disabled="actionStatus === 'submitting'"
              @update:model-value="
                emit('update:rejectionReason', String($event))
              "
            />
          </Field>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              :disabled="
                actionStatus === 'submitting' || !rejectionReason.trim()
              "
              @click="emit('action', 'reject')"
            >
              <Spinner
                v-if="actionStatus === 'submitting'"
                data-icon="inline-start"
              />
              拒绝申请
            </Button>
            <Button
              :disabled="actionStatus === 'submitting'"
              @click="emit('action', 'approve')"
            >
              <Spinner
                v-if="actionStatus === 'submitting'"
                data-icon="inline-start"
              />
              通过申请
            </Button>
          </div>
        </FieldGroup>
        <div v-else-if="canReceive" class="flex flex-col gap-3 border-t pt-4">
          <p class="text-sm text-muted-foreground">
            确认包裹已收到后进入验货流程。
          </p>
          <Button
            :disabled="actionStatus === 'submitting'"
            @click="emit('action', 'received')"
          >
            <Spinner
              v-if="actionStatus === 'submitting'"
              data-icon="inline-start"
            />
            确认收到退货
          </Button>
        </div>
        <div
          v-else-if="canStartRefund"
          class="flex flex-col gap-3 border-t pt-4"
        >
          <p class="text-sm text-muted-foreground">
            验货完成后登记退款处理中，不会调用真实退款渠道。
          </p>
          <Button
            :disabled="actionStatus === 'submitting'"
            @click="emit('action', 'refund-processing')"
          >
            <Spinner
              v-if="actionStatus === 'submitting'"
              data-icon="inline-start"
            />
            登记退款处理中
          </Button>
        </div>
        <div
          v-else-if="canCompleteRefund"
          class="flex flex-col gap-3 border-t pt-4"
        >
          <Alert>
            <AlertDescription>
              完成后将登记固定金额 {{ application.currency }}
              {{ application.refundAmount }}；不会实际向支付渠道退款。
            </AlertDescription>
          </Alert>
          <Button
            :disabled="actionStatus === 'submitting'"
            @click="confirmRefundOpen = true"
          >
            <Spinner
              v-if="actionStatus === 'submitting'"
              data-icon="inline-start"
            />
            登记退款完成
          </Button>
        </div>
        <Alert v-if="application.rejectionReason">
          <AlertDescription
            >拒绝原因：{{ application.rejectionReason }}</AlertDescription
          >
        </Alert>
        <Alert v-if="actionError" variant="destructive">
          <AlertDescription role="alert">{{ actionError }}</AlertDescription>
        </Alert>
        <section
          v-if="application.events.length"
          class="flex flex-col gap-2 border-t pt-4"
        >
          <h3 class="text-sm font-semibold">处理记录</h3>
          <ol class="flex flex-col gap-2 text-sm">
            <li
              v-for="(event, index) in application.events"
              :key="`${event.action}-${event.createdAt}-${index}`"
              class="flex flex-wrap justify-between gap-2"
            >
              <span
                >{{ statusLabels[event.toStatus] }} ·
                {{ event.actorRole }}</span
              >
              <time class="text-muted-foreground">{{
                formatDate(event.createdAt)
              }}</time>
            </li>
          </ol>
        </section>
      </template>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:modelValue', false)"
          >关闭</Button
        >
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <AlertDialog v-model:open="confirmRefundOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>登记退款完成？</AlertDialogTitle>
        <AlertDialogDescription>
          这只会把申请状态记录为“本站已登记退款完成”，不会向任何资金渠道退款。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>返回</AlertDialogCancel>
        <AlertDialogAction @click="emit('action', 'refunded')">
          确认登记
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
