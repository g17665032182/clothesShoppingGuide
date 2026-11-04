<script setup lang="ts">
import { SendHorizontal, Square } from '@lucide/vue';
import type { ChatContextUsage } from '@/api/types/chat';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import ChatContextUsageIndicator from './ChatContextUsage.vue';

defineProps<{
  canSend: boolean;
  draft: string;
  isSending: boolean;
  context: ChatContextUsage | null;
  contextIsPrevious: boolean;
}>();

const emit = defineEmits<{
  (event: 'submit'): void;
  (event: 'stop'): void;
  (event: 'update:draft', value: string): void;
  (event: 'keydown', keyboardEvent: KeyboardEvent): void;
}>();
</script>

<template>
  <form class="mx-auto w-full max-w-3xl" @submit.prevent="emit('submit')">
    <InputGroup>
      <InputGroupTextarea
        :model-value="draft"
        aria-label="输入消息"
        class="max-h-56 min-h-16 resize-none"
        maxlength="2000"
        placeholder="描述你的场合、天气或已有单品…"
        rows="2"
        @keydown="emit('keydown', $event)"
        @update:model-value="emit('update:draft', String($event))"
      />
      <InputGroupAddon align="block-end">
        <ChatContextUsageIndicator
          :context="context"
          :is-previous="contextIsPrevious"
        />
        <InputGroupButton
          v-if="isSending"
          aria-label="停止生成"
          class="ml-auto shrink-0 justify-center has-data-[icon=inline-start]:pl-0"
          size="icon-sm"
          title="停止生成"
          type="button"
          variant="outline"
          @click="emit('stop')"
        >
          <Square
            aria-hidden="true"
            data-icon="inline-start"
            fill="currentColor"
          />
        </InputGroupButton>
        <InputGroupButton
          v-else
          :disabled="!canSend"
          aria-label="发送消息"
          class="ml-auto shrink-0 justify-center has-data-[icon=inline-start]:pl-0"
          size="icon-sm"
          title="发送消息"
          type="submit"
          variant="default"
        >
          <!-- 纸飞机绕中心旋转朝上，按钮不保留文字前缀图标的左侧内边距。 -->
          <SendHorizontal
            aria-hidden="true"
            class="-rotate-90"
            data-icon="inline-start"
          />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </form>
</template>
