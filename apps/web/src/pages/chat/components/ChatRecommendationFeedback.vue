<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, ThumbsDown, ThumbsUp } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import type {
  RecommendationFeedbackReason,
  RecommendationFeedbackTargetType,
  RecommendationFeedbackType,
} from '@/api/types/fashion-recommendation';

type FeedbackStatus =
  'idle' | 'submitting' | 'accepted' | 'duplicate' | 'disabled' | 'error';

const props = withDefaults(
  defineProps<{
    recommendationId: string;
    conversationId: string;
    assistantMessageId: string;
    targetType: RecommendationFeedbackTargetType;
    targetRef: string;
    disabled?: boolean;
    status?: FeedbackStatus;
    errorMessage?: string;
  }>(),
  {
    status: 'idle',
    errorMessage: '',
    disabled: false,
  },
);

const emit = defineEmits<{
  (
    event: 'submit',
    payload: {
      recommendationId: string;
      conversationId: string;
      assistantMessageId: string;
      targetType: RecommendationFeedbackTargetType;
      targetRef: string;
      feedbackType: RecommendationFeedbackType;
      reasonCode?: RecommendationFeedbackReason;
      note?: string;
    },
  ): void;
}>();

const reason = ref<RecommendationFeedbackReason | ''>('');
const note = ref('');
const showReason = ref(false);
const canSubmit = computed(
  () =>
    !props.disabled &&
    props.status !== 'submitting' &&
    !(showReason.value && !reason.value && !note.value.trim()),
);

function submit(feedbackType: RecommendationFeedbackType): void {
  if (!canSubmit.value) return;
  if (feedbackType === 'negative') {
    showReason.value = true;
    if (!reason.value && !note.value.trim()) return;
  }
  emit('submit', {
    recommendationId: props.recommendationId,
    conversationId: props.conversationId,
    assistantMessageId: props.assistantMessageId,
    targetType: props.targetType,
    targetRef: props.targetRef,
    feedbackType,
    ...(reason.value ? { reasonCode: reason.value } : {}),
    ...(note.value.trim() ? { note: note.value.trim() } : {}),
  });
}
</script>

<template>
  <div class="grid gap-2" aria-label="推荐反馈">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-muted-foreground">这套推荐合适吗？</span>
      <Button
        size="sm"
        variant="outline"
        :disabled="!canSubmit"
        :aria-pressed="props.status === 'accepted'"
        @click="submit('positive')"
      >
        <Spinner
          v-if="props.status === 'submitting'"
          data-icon="inline-start"
        />
        <Check v-else data-icon="inline-start" />
        合适
      </Button>
      <Button
        size="sm"
        variant="outline"
        :disabled="!canSubmit"
        :aria-pressed="props.status === 'duplicate'"
        @click="submit('negative')"
      >
        <ThumbsDown data-icon="inline-start" />
        不合适
      </Button>
      <span
        v-if="props.status === 'accepted' || props.status === 'duplicate'"
        class="inline-flex items-center gap-1 text-xs text-muted-foreground"
        role="status"
      >
        <ThumbsUp aria-hidden="true" class="size-3.5" />
        已记录
      </span>
      <span
        v-else-if="props.status === 'disabled'"
        class="text-xs text-muted-foreground"
        role="status"
      >
        推荐学习已关闭，本次不会保存反馈
      </span>
    </div>

    <div
      v-if="showReason"
      class="grid max-w-sm gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
    >
      <NativeSelect v-model="reason" aria-label="不合适原因">
        <NativeSelectOption value="">选择原因（可选）</NativeSelectOption>
        <NativeSelectOption value="style">风格不合适</NativeSelectOption>
        <NativeSelectOption value="color">颜色不合适</NativeSelectOption>
        <NativeSelectOption value="price">价格不合适</NativeSelectOption>
        <NativeSelectOption value="occasion">场合不合适</NativeSelectOption>
        <NativeSelectOption value="fit">版型不合适</NativeSelectOption>
        <NativeSelectOption value="too_exaggerated">太夸张</NativeSelectOption>
        <NativeSelectOption value="too_plain">太普通</NativeSelectOption>
      </NativeSelect>
      <input
        v-model="note"
        class="min-h-9 min-w-0 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        maxlength="200"
        placeholder="补充说明（原因或说明至少填一项）"
        aria-label="补充反馈"
        @keydown.enter.prevent="submit('negative')"
      />
    </div>
    <p
      v-if="props.status === 'error'"
      class="text-xs text-destructive"
      role="alert"
    >
      {{ props.errorMessage || '反馈提交失败，请稍后重试。' }}
    </p>
  </div>
</template>
