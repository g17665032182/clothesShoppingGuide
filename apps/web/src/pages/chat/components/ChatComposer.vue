<script setup lang="ts">
import { Send } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

defineProps<{
  canSend: boolean;
  draft: string;
}>();

const emit = defineEmits<{
  (event: 'submit'): void;
  (event: 'update:draft', value: string): void;
  (event: 'keydown', keyboardEvent: KeyboardEvent): void;
}>();
</script>

<template>
  <form
    class="flex w-full items-end gap-3 rounded-xl border border-border bg-card px-3 py-3"
    @submit.prevent="emit('submit')"
  >
    <Textarea
      :model-value="draft"
      aria-label="输入消息"
      class="min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      maxlength="2000"
      placeholder="描述你的场合、天气或已有单品…"
      rows="2"
      @keydown="emit('keydown', $event)"
      @update:model-value="emit('update:draft', String($event))"
    />
    <Button
      :disabled="!canSend"
      aria-label="发送消息"
      class="shrink-0 rounded-full"
      size="icon"
      title="发送消息"
      type="submit"
    >
      <Send aria-hidden="true" data-icon="inline-start" />
    </Button>
  </form>
</template>
