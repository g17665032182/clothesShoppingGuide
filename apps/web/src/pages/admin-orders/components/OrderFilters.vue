<script setup lang="ts">
import { X } from '@lucide/vue';
import type {
  AdminOrderQuery,
  AdminOrderStatus,
} from '@/api/types/admin-orders';
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

defineProps<{
  query: AdminOrderQuery;
  loading: boolean;
  statusLabels: Record<AdminOrderStatus, string>;
}>();

const emit = defineEmits<{
  (event: 'update:orderNo', value: string | undefined): void;
  (event: 'update:userId', value: string | undefined): void;
  (event: 'update:status', value: AdminOrderStatus | undefined): void;
  (event: 'reset'): void;
}>();
</script>

<template>
  <FieldGroup
    class="grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_160px_auto] md:items-end"
  >
    <Field>
      <FieldLabel for="admin-order-number">订单号</FieldLabel>
      <Input
        id="admin-order-number"
        :model-value="query.orderNo ?? ''"
        placeholder="精确查询订单号"
        @change="
          emit(
            'update:orderNo',
            ($event.target as HTMLInputElement).value.trim() || undefined,
          )
        "
      />
    </Field>
    <Field>
      <FieldLabel for="admin-order-user">买家 ID</FieldLabel>
      <Input
        id="admin-order-user"
        :model-value="query.userId ?? ''"
        placeholder="用户 UUID"
        @change="
          emit(
            'update:userId',
            ($event.target as HTMLInputElement).value.trim() || undefined,
          )
        "
      />
    </Field>
    <Field>
      <FieldLabel for="admin-order-status">订单状态</FieldLabel>
      <Select
        :model-value="query.status ?? 'all'"
        @update:model-value="
          emit(
            'update:status',
            $event === 'all' ? undefined : (String($event) as AdminOrderStatus),
          )
        "
      >
        <SelectTrigger id="admin-order-status"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem
              v-for="(label, value) in statusLabels"
              :key="value"
              :value="value"
            >
              {{ label }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    <Button variant="outline" :disabled="loading" @click="emit('reset')">
      <X data-icon="inline-start" />
      重置
    </Button>
  </FieldGroup>
</template>
