<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ImageOff } from '@lucide/vue';

const props = defineProps<{ src: string | null; alt: string }>();
const failed = ref(false);
const safeSource = computed(() => {
  if (!props.src) return null;
  try {
    const url = new URL(props.src);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
});

watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <div
    class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted"
  >
    <img
      v-if="safeSource && !failed"
      :src="safeSource"
      :alt="alt"
      loading="lazy"
      class="size-full object-cover"
      @error="failed = true"
    />
    <ImageOff v-else class="size-5 text-muted-foreground" aria-hidden="true" />
  </div>
</template>
