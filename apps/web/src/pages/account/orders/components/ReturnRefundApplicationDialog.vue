<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { ApiError } from '@/api';
import {
  getReturnRefundOptions,
  createReturnRefundApplication,
} from '@/api/modules/return-refund';
import type {
  ReturnRefundItemRequest,
  ReturnRefundOrderOptions,
} from '@/api/types/return-refund';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { auth } from '@/lib/auth';

type LoadStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'empty'
  | 'error'
  | 'unknown';
type SubmitStatus = 'idle' | 'submitting' | 'unknown' | 'error';

const props = defineProps<{
  modelValue: boolean;
  orderId: string | null;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  created: [applicationId: string];
}>();

const options = ref<ReturnRefundOrderOptions | null>(null);
const loadStatus = ref<LoadStatus>('idle');
const loadError = ref('');
const reason = ref('');
const quantities = ref<Record<string, number>>({});
const submitStatus = ref<SubmitStatus>('idle');
const submitError = ref('');
const idempotencyKey = ref<string | null>(null);
let controller: AbortController | null = null;
let version = 0;
let identityVersion = 0;
let disposed = false;

function currentIdentity(capturedVersion: number, userId: string | undefined) {
  return (
    !disposed &&
    capturedVersion === identityVersion &&
    userId === (auth.state.token ? auth.state.user?.id : undefined)
  );
}

watch(
  () => (auth.state.token ? auth.state.user?.id : null),
  () => {
    identityVersion += 1;
    controller?.abort();
    controller = null;
    options.value = null;
    loadStatus.value = 'idle';
    submitStatus.value = 'idle';
    submitError.value = '';
    quantities.value = {};
    reason.value = '';
    idempotencyKey.value = null;
    if (props.modelValue && props.orderId && auth.state.token)
      void loadOptions(props.orderId);
  },
  { flush: 'sync' },
);

const selectedItems = computed<ReturnRefundItemRequest[]>(() =>
  Object.entries(quantities.value)
    .filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
);

function amountInCents(value: string): number {
  const match = /^(\d+)\.(\d{2})$/u.exec(value);
  return match ? Number(match[1]) * 100 + Number(match[2]) : 0;
}

const refundAmount = computed(() => {
  const lines = options.value?.items ?? [];
  const cents = selectedItems.value.reduce((total, selected) => {
    const line = lines.find(
      (item) => item.orderItemId === selected.orderItemId,
    );
    return (
      total + (line ? amountInCents(line.unitPrice) * selected.quantity : 0)
    );
  }, 0);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
});

const reasonError = computed(() => {
  if (reason.value.length > 1000) return '退货原因不能超过 1000 个字符。';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reason.value))
    return '退货原因不能包含控制字符。';
  return '';
});

const canSubmit = computed(
  () =>
    loadStatus.value === 'success' &&
    selectedItems.value.length > 0 &&
    reason.value.trim().length > 0 &&
    !reasonError.value &&
    submitStatus.value !== 'submitting',
);

async function loadOptions(orderId: string): Promise<void> {
  const token = auth.state.token;
  if (!token) return;
  controller?.abort();
  const request = new AbortController();
  controller = request;
  const requestVersion = ++version;
  const identity = identityVersion;
  const userId = auth.state.user?.id;
  loadStatus.value = 'loading';
  loadError.value = '';
  try {
    const result = await getReturnRefundOptions(token, orderId, request.signal);
    if (
      request.signal.aborted ||
      requestVersion !== version ||
      !currentIdentity(identity, userId)
    )
      return;
    options.value = result;
    quantities.value = Object.fromEntries(
      result.items.map((item) => [item.orderItemId, 0]),
    );
    loadStatus.value = result.items.length ? 'success' : 'empty';
  } catch (error) {
    if (
      !request.signal.aborted &&
      requestVersion === version &&
      currentIdentity(identity, userId)
    ) {
      loadStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      loadError.value =
        error instanceof Error ? error.message : '无法读取订单商品。';
    }
  }
}

watch(
  () => [props.modelValue, props.orderId] as const,
  ([open, orderId]) => {
    if (!open || !orderId) {
      controller?.abort();
      options.value = null;
      loadStatus.value = 'idle';
      submitStatus.value = 'idle';
      submitError.value = '';
      reason.value = '';
      quantities.value = {};
      idempotencyKey.value = null;
      return;
    }
    void loadOptions(orderId);
  },
  { immediate: true },
);
watch(reason, () => {
  if (submitStatus.value !== 'unknown') {
    idempotencyKey.value = null;
    if (submitStatus.value === 'error') submitStatus.value = 'idle';
  }
});

function updateQuantity(orderItemId: string, rawValue: string): void {
  const value = Number(rawValue);
  const item = options.value?.items.find(
    (candidate) => candidate.orderItemId === orderItemId,
  );
  if (!item) return;
  quantities.value = {
    ...quantities.value,
    [orderItemId]: Number.isInteger(value)
      ? Math.min(Math.max(value, 0), item.availableQuantity)
      : 0,
  };
  if (submitStatus.value !== 'unknown') {
    submitStatus.value = 'idle';
    submitError.value = '';
    idempotencyKey.value = null;
  }
}

async function submit(): Promise<void> {
  const token = auth.state.token;
  const orderId = props.orderId;
  if (!token || !orderId || !canSubmit.value) return;
  const identity = identityVersion;
  const userId = auth.state.user?.id;
  idempotencyKey.value ??= crypto.randomUUID();
  submitStatus.value = 'submitting';
  submitError.value = '';
  try {
    const result = await createReturnRefundApplication(token, orderId, {
      items: selectedItems.value,
      reason: reason.value.trim(),
      idempotencyKey: idempotencyKey.value,
    });
    if (!currentIdentity(identity, userId)) return;
    submitStatus.value = 'idle';
    toast.success('退货退款申请已提交，等待管理员审核');
    emit('created', result.id);
    emit('update:modelValue', false);
  } catch (error) {
    if (!currentIdentity(identity, userId)) return;
    submitStatus.value =
      error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
    submitError.value =
      error instanceof Error ? error.message : '申请提交失败，请重试。';
  }
}

function close(): void {
  if (submitStatus.value === 'submitting' || submitStatus.value === 'unknown')
    return;
  emit('update:modelValue', false);
}

onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
});
</script>

<template>
  <Dialog :open="modelValue" @update:open="close">
    <DialogContent
      class="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
      :show-close-button="
        submitStatus !== 'submitting' && submitStatus !== 'unknown'
      "
      @escape-key-down="
        submitStatus === 'unknown' ? $event.preventDefault() : undefined
      "
      @interact-outside="
        submitStatus === 'unknown' ? $event.preventDefault() : undefined
      "
    >
      <DialogHeader>
        <DialogTitle>申请退货退款</DialogTitle>
        <DialogDescription class="break-all">
          {{ options?.orderNo ?? '正在读取订单' }}
        </DialogDescription>
      </DialogHeader>
      <div v-if="loadStatus === 'loading'" class="flex flex-col gap-3">
        <Skeleton class="h-8 w-1/2" />
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-24 w-full" />
      </div>
      <div
        v-else-if="loadStatus === 'error' || loadStatus === 'unknown'"
        class="flex flex-col items-start gap-3"
      >
        <Alert variant="destructive">
          <AlertDescription role="status">
            {{ loadError || '读取结果未确认，请重新读取后继续。' }}
          </AlertDescription>
        </Alert>
        <Button variant="outline" @click="orderId && loadOptions(orderId)">
          重新读取
        </Button>
      </div>
      <Alert v-else-if="loadStatus === 'empty'">
        <AlertDescription>该订单暂无可申请的商品数量。</AlertDescription>
      </Alert>
      <form
        v-else-if="options"
        class="flex flex-col gap-5"
        @submit.prevent="submit"
      >
        <Alert>
          <AlertDescription>
            本站会按订单状态和确认收货时间进行规则初筛；超期或无法判定时转人工审核，不会自动拒绝。
          </AlertDescription>
        </Alert>
        <FieldGroup class="grid gap-3">
          <Field
            v-for="item in options.items"
            :key="item.orderItemId"
            class="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_120px] sm:items-center"
          >
            <div class="flex min-w-0 items-center gap-3">
              <img
                v-if="item.imageUrl"
                :src="item.imageUrl"
                :alt="item.productName"
                class="size-12 shrink-0 rounded-sm object-cover"
              />
              <div class="min-w-0">
                <p class="wrap-break-word font-medium">{{ item.productName }}</p>
                <p class="text-sm text-muted-foreground">
                  {{ item.color }} / {{ item.size }} · ¥{{ item.unitPrice }}
                </p>
                <p class="text-xs text-muted-foreground">
                  可申请 {{ item.availableQuantity }} / {{ item.quantity }} 件
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <FieldLabel
                :for="`return-quantity-${item.orderItemId}`"
                class="text-sm"
              >
                退货数量
              </FieldLabel>
              <Input
                :id="`return-quantity-${item.orderItemId}`"
                type="number"
                min="0"
                :max="item.availableQuantity"
                step="1"
                class="w-20"
                :disabled="
                  submitStatus === 'submitting' || submitStatus === 'unknown'
                "
                :model-value="quantities[item.orderItemId] ?? 0"
                @update:model-value="
                  updateQuantity(item.orderItemId, String($event))
                "
              />
            </div>
          </Field>
          <Field :data-invalid="Boolean(reasonError) || undefined">
            <FieldLabel for="return-reason">退货原因</FieldLabel>
            <Textarea
              id="return-reason"
              v-model="reason"
              maxlength="1000"
              rows="4"
              required
              :disabled="
                submitStatus === 'submitting' || submitStatus === 'unknown'
              "
              :aria-invalid="Boolean(reasonError)"
              placeholder="请描述需要退货的原因"
            />
            <p v-if="reasonError" role="alert" class="text-sm text-destructive">
              {{ reasonError }}
            </p>
          </Field>
        </FieldGroup>
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
        >
          <p class="text-sm">
            申请金额
            <strong class="ml-2 font-semibold">
              {{ options.currency }} {{ refundAmount }}
            </strong>
          </p>
          <p class="text-xs text-muted-foreground">
            金额按订单商品快照计算，最终由本站审核。
          </p>
        </div>
        <Alert v-if="submitError" variant="destructive">
          <AlertDescription role="alert">{{ submitError }}</AlertDescription>
        </Alert>
        <Alert v-if="submitStatus === 'unknown'">
          <AlertDescription>
            提交结果尚未确认。保持申请内容不变后可用同一请求重试，避免重复申请。
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="
              submitStatus === 'submitting' || submitStatus === 'unknown'
            "
            @click="close"
          >
            取消
          </Button>
          <Button type="submit" :disabled="!canSubmit">
            {{
              submitStatus === 'submitting'
                ? '正在提交'
                : submitStatus === 'unknown'
                  ? '重试提交'
                  : '提交申请'
            }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
