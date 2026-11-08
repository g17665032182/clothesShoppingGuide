<script setup lang="ts">
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

defineProps<{ modelValue: boolean; action: 'cancel' | 'receipt' }>();
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'confirm'): void;
}>();
</script>

<template>
  <AlertDialog
    :open="modelValue"
    @update:open="emit('update:modelValue', $event)"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{
          action === 'cancel' ? '取消订单？' : '确认已收货？'
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{
            action === 'cancel'
              ? '取消后订单将关闭，库存按服务端规则释放。'
              : '确认收货后订单将标记为已完成。'
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>返回</AlertDialogCancel>
        <AlertDialogAction @click="emit('confirm')">确认</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
