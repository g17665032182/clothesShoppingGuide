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
    class="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
  >
    <div class="flex items-center gap-3">
      <Avatar size="lg">
        <AvatarFallback>
          <Sparkles aria-hidden="true" data-icon="inline-start" />
        </AvatarFallback>
      </Avatar>
      <div class="min-w-0">
        <CardTitle>{{ title }}</CardTitle>
        <CardDescription class="mt-1 flex items-center gap-1.5">
          <span
            class="size-1.5 rounded-full bg-primary"
            aria-hidden="true"
          ></span>
          穿搭顾问在线
        </CardDescription>
      </div>
    </div>
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
  </header>
</template>
