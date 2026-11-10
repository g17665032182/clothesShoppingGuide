<script setup lang="ts">
import { reactive, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import type {
  UserAddress,
  UserAddressFormValue,
} from '@/api/types/user-addresses';

const props = defineProps<{
  modelValue: boolean;
  address: UserAddress | null;
  submitting: boolean;
  resultUnknown: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [value: UserAddressFormValue];
}>();

const form = reactive({
  recipientName: '',
  phone: '',
  address: '',
  label: '',
  isDefault: false,
});
const errors = reactive({
  recipientName: '',
  phone: '',
  address: '',
});

function resetForm(): void {
  form.recipientName = props.address?.recipientName ?? '';
  form.phone = props.address?.phone ?? '';
  form.address = props.address?.address ?? '';
  form.label = props.address?.label ?? '';
  form.isDefault = props.address?.isDefault ?? false;
  errors.recipientName = '';
  errors.phone = '';
  errors.address = '';
}

watch(
  () => [props.modelValue, props.address?.id] as const,
  ([open]) => {
    if (open) resetForm();
  },
  { immediate: true },
);

function validate(): boolean {
  errors.recipientName = form.recipientName.trim() ? '' : '请输入收件人姓名';
  errors.phone = /^\+?\d{6,20}$/u.test(form.phone.trim())
    ? ''
    : '请输入 6–20 位数字，可带 + 前缀';
  errors.address = form.address.trim() ? '' : '请输入完整收货地址';
  return !errors.recipientName && !errors.phone && !errors.address;
}

function submit(): void {
  if (props.submitting || !validate()) return;
  emit('submit', {
    recipientName: form.recipientName,
    phone: form.phone,
    address: form.address,
    label: form.label.trim() || null,
    isDefault: form.isDefault,
  });
}
</script>

<template>
  <Dialog :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogContent
      class="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
      :show-close-button="!submitting && !resultUnknown"
      @escape-key-down="resultUnknown ? $event.preventDefault() : undefined"
      @interact-outside="resultUnknown ? $event.preventDefault() : undefined"
    >
      <DialogHeader>
        <DialogTitle>{{
          address ? '编辑收货地址' : '新增收货地址'
        }}</DialogTitle>
        <DialogDescription>
          地址仅供本人管理，订单会保存下单时的收货信息。
        </DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-5" @submit.prevent="submit">
        <FieldGroup class="grid gap-4">
          <Field :data-invalid="Boolean(errors.recipientName) || undefined">
            <FieldLabel for="address-recipient-name">收件人</FieldLabel>
            <Input
              id="address-recipient-name"
              v-model="form.recipientName"
              autocomplete="name"
              maxlength="100"
              required
              :disabled="submitting || resultUnknown"
              :aria-invalid="Boolean(errors.recipientName)"
              :aria-describedby="
                errors.recipientName
                  ? 'address-recipient-name-error'
                  : undefined
              "
              @input="errors.recipientName = ''"
            />
            <p
              v-if="errors.recipientName"
              id="address-recipient-name-error"
              role="alert"
              class="text-sm text-destructive"
            >
              {{ errors.recipientName }}
            </p>
          </Field>
          <Field :data-invalid="Boolean(errors.phone) || undefined">
            <FieldLabel for="address-phone">联系电话</FieldLabel>
            <Input
              id="address-phone"
              v-model="form.phone"
              type="tel"
              autocomplete="tel"
              maxlength="21"
              required
              :disabled="submitting || resultUnknown"
              :aria-invalid="Boolean(errors.phone)"
              :aria-describedby="
                errors.phone ? 'address-phone-error' : undefined
              "
              @input="errors.phone = ''"
            />
            <p
              v-if="errors.phone"
              id="address-phone-error"
              role="alert"
              class="text-sm text-destructive"
            >
              {{ errors.phone }}
            </p>
          </Field>
          <Field :data-invalid="Boolean(errors.address) || undefined">
            <FieldLabel for="address-full">收货地址</FieldLabel>
            <Textarea
              id="address-full"
              v-model="form.address"
              autocomplete="street-address"
              maxlength="500"
              required
              rows="3"
              :disabled="submitting || resultUnknown"
              :aria-invalid="Boolean(errors.address)"
              :aria-describedby="
                errors.address ? 'address-full-error' : undefined
              "
              @input="errors.address = ''"
            />
            <p
              v-if="errors.address"
              id="address-full-error"
              role="alert"
              class="text-sm text-destructive"
            >
              {{ errors.address }}
            </p>
          </Field>
          <Field>
            <FieldLabel for="address-label">地址标签</FieldLabel>
            <Input
              id="address-label"
              v-model="form.label"
              maxlength="40"
              placeholder="例如：家、公司"
              :disabled="submitting || resultUnknown"
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="address-is-default"
              :model-value="form.isDefault"
              :disabled="submitting || resultUnknown"
              @update:model-value="form.isDefault = $event === true"
            />
            <FieldLabel for="address-is-default">设为默认地址</FieldLabel>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="submitting || resultUnknown"
            @click="emit('update:modelValue', false)"
          >
            取消
          </Button>
          <Button type="submit" :disabled="submitting">
            <Spinner v-if="submitting" data-icon="inline-start" />
            {{ resultUnknown ? '重试保存' : address ? '保存修改' : '保存地址' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
