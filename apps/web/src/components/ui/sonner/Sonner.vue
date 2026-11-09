<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from '@lucide/vue';
import { reactiveOmit } from '@vueuse/core';
import { cn } from 'cn';
import { Toaster as Sonner } from 'vue-sonner';

const props = defineProps<ToasterProps>();
const delegatedProps = reactiveOmit(props, 'class', 'toastOptions');
</script>

<template>
  <Sonner
    :class="cn('toaster group pointer-events-auto', props.class)"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
      '--gray2': 'var(--muted)',
      '--gray3': 'var(--border)',
      '--gray4': 'var(--border)',
      '--gray5': 'var(--border)',
      '--gray12': 'var(--popover-foreground)',
    }"
    :toast-options="
      props.toastOptions ?? {
        classes: {
          toast: 'rounded-md',
        },
      }
    "
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <CircleCheckIcon />
    </template>
    <template #info-icon>
      <InfoIcon />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon />
    </template>
    <template #error-icon>
      <OctagonXIcon />
    </template>
    <template #loading-icon>
      <div>
        <Loader2Icon class="animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon />
    </template>
  </Sonner>
</template>
