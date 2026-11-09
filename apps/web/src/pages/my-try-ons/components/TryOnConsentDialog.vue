<script setup lang="ts">
import { ref, watch } from 'vue';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const props = defineProps<{ open: boolean; busy?: boolean }>();
const emit = defineEmits<{
  (event: 'update:open', value: boolean): void;
  (event: 'confirm'): void;
}>();
const agreed = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) agreed.value = false;
  },
);
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>第三方 AI 处理说明</DialogTitle>
        <DialogDescription>
          生成试穿图需要将你选择的照片和商品图片发送给图像生成服务。生成结果仅供视觉参考，不代表真实尺码或合身程度。
        </DialogDescription>
      </DialogHeader>
      <label class="flex items-start gap-3 text-sm">
        <Checkbox v-model="agreed" class="mt-0.5" />
        <span>我同意将这张照片发送给第三方服务用于本次试穿。</span>
      </label>
      <DialogFooter>
        <Button
          variant="outline"
          :disabled="busy"
          @click="emit('update:open', false)"
          >取消</Button
        >
        <Button :disabled="!agreed || busy" @click="emit('confirm')">
          {{ busy ? '提交中' : '同意并生成' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
