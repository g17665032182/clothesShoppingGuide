<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Truck } from '@lucide/vue';
import type {
  AdminOrderDetail,
  ShipOrderPayload,
} from '@/api/types/admin-orders';
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
import { Spinner } from '@/components/ui/spinner';

const props = defineProps<{
  modelValue: boolean;
  order: AdminOrderDetail | null;
  submitting: boolean;
  refreshing: boolean;
  error: string;
}>();
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'submit', payload: ShipOrderPayload): void;
  (event: 'reload'): void;
}>();
const carrier = ref('');
const trackingNo = ref('');
const fieldError = computed(() => {
  const values = [carrier.value, trackingNo.value];
  if (values.some((value) => /[\u0000-\u001f\u007f]/u.test(value)))
    return '物流信息不能包含控制字符。';
  return '';
});
const inputsDisabled = computed(() => props.submitting || props.refreshing);
const canSubmit = computed(
  () =>
    carrier.value.trim() &&
    trackingNo.value.trim() &&
    !fieldError.value &&
    props.order?.status === 'pending_shipment' &&
    !props.refreshing &&
    !props.submitting,
);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      carrier.value = '';
      trackingNo.value = '';
    }
  },
);

function submit(): void {
  if (!canSubmit.value) return;
  emit('submit', {
    carrier: carrier.value.trim(),
    trackingNo: trackingNo.value.trim(),
  });
}
</script>

<template>
  <Dialog
    :open="modelValue"
    @update:open="!submitting && emit('update:modelValue', $event)"
  >
    <DialogContent :show-close-button="!submitting" class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>整单发货</DialogTitle>
        <DialogDescription class="break-all">{{
          order?.orderNo
        }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-5" @submit.prevent="submit">
        <FieldGroup>
          <Field
            :data-disabled="inputsDisabled"
            :data-invalid="Boolean(fieldError)"
          >
            <FieldLabel for="shipment-carrier">快递公司</FieldLabel>
            <Input
              id="shipment-carrier"
              v-model="carrier"
              :disabled="inputsDisabled"
              :aria-invalid="Boolean(fieldError)"
              maxlength="100"
              required
              autocomplete="off"
              placeholder="填写快递公司"
            />
          </Field>
          <Field
            :data-disabled="inputsDisabled"
            :data-invalid="Boolean(fieldError)"
          >
            <FieldLabel for="shipment-tracking">运单号</FieldLabel>
            <Input
              id="shipment-tracking"
              v-model="trackingNo"
              :disabled="inputsDisabled"
              :aria-invalid="Boolean(fieldError)"
              maxlength="100"
              required
              autocomplete="off"
              placeholder="填写运单号"
            />
          </Field>
        </FieldGroup>
        <Alert v-if="fieldError" variant="destructive"
          ><AlertDescription role="alert">{{
            fieldError
          }}</AlertDescription></Alert
        >
        <Alert v-if="order && order.status !== 'pending_shipment'"
          ><AlertDescription
            >订单状态已更新，当前不能发货。</AlertDescription
          ></Alert
        >
        <div v-if="error" class="flex flex-col items-start gap-2">
          <Button
            type="button"
            variant="outline"
            :disabled="submitting"
            @click="emit('reload')"
            >重新读取订单</Button
          >
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="submitting"
            @click="emit('update:modelValue', false)"
            >取消</Button
          >
          <Button type="submit" :disabled="!canSubmit">
            <Spinner v-if="submitting" data-icon="inline-start" />
            <Truck v-else data-icon="inline-start" />
            {{ submitting ? '正在发货' : '确认发货' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
