<script setup lang="ts">
import { Plus, Sparkles } from '@lucide/vue';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CardDescription, CardTitle } from '@/components/ui/card';

defineProps<{
  title: string;
}>();

const emit = defineEmits<{
  (event: 'new'): void;
}>();
</script>

<template>
  <header
    class="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6"
  >
    <div class="flex min-w-0 flex-1 basis-40 items-center gap-3">
      <Avatar size="lg">
        <AvatarFallback>
          <Sparkles aria-hidden="true" data-icon="inline-start" />
        </AvatarFallback>
      </Avatar>
      <div class="min-w-0">
        <CardTitle class="wrap-anywhere">{{ title }}</CardTitle>
        <CardDescription class="mt-1 flex items-center gap-1.5">
          <span
            class="size-1.5 rounded-full bg-primary"
            aria-hidden="true"
          ></span>
          穿搭顾问在线
        </CardDescription>
      </div>
    </div>
    <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <slot name="actions" />
      <Button
        aria-label="开始新对话"
        size="sm"
        type="button"
        variant="outline"
        @click="emit('new')"
      >
        <Plus aria-hidden="true" data-icon="inline-start" />
        新对话
      </Button>
    </div>
  </header>
</template>
