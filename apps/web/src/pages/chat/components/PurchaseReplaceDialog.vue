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

defineProps<{ open: boolean; productExternalId: string | null }>();
const emit = defineEmits<{
  (event: 'update:open', value: boolean): void;
  (event: 'confirm'): void;
}>();
</script>

<template>
  <AlertDialog :open="open" @update:open="emit('update:open', $event)">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>替换当前购买草稿？</AlertDialogTitle>
        <AlertDialogDescription class="break-all">
          当前会话已有其他商品草稿。确认后会放弃旧草稿并开始
          {{ productExternalId }}。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="emit('update:open', false)"
          >保留旧草稿</AlertDialogCancel
        >
        <AlertDialogAction @click="emit('confirm')">确认替换</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
