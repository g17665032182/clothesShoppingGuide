<script setup lang="ts">
import { Send, Square } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

defineProps<{
  canSend: boolean;
  draft: string;
  isSending: boolean;
}>();

const emit = defineEmits<{
  (event: 'submit'): void;
  (event: 'stop'): void;
  (event: 'update:draft', value: string): void;
  (event: 'keydown', keyboardEvent: KeyboardEvent): void;
}>();
</script>

<template>
  <form
    class="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3"
    @submit.prevent="emit('submit')"
  >
    <Textarea
      :model-value="draft"
      aria-label="输入消息"
      class="min-h-12 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
      maxlength="2000"
      placeholder="描述你的场合、天气或已有单品…"
      rows="2"
      @keydown="emit('keydown', $event)"
      @update:model-value="emit('update:draft', String($event))"
    />
    <div class="flex justify-end">
      <Button
        v-if="isSending"
        aria-label="停止生成"
        class="shrink-0 rounded-full"
        size="icon"
        title="停止生成"
        type="button"
        variant="outline"
        @click="emit('stop')"
      >
        <Square aria-hidden="true" />
      </Button>
      <Button
        v-else
        :disabled="!canSend"
        aria-label="发送消息"
        class="shrink-0 rounded-full"
        size="icon"
        title="发送消息"
        type="submit"
      >
        <Send aria-hidden="true" data-icon="inline-start" />
      </Button>
    </div>
  </form>
</template>
