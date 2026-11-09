<script lang="ts" setup>
import type { StepperIndicatorProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { cn } from '@/lib/utils';
import { StepperIndicator, useForwardProps } from 'reka-ui';

const props = defineProps<
  StepperIndicatorProps & { class?: HTMLAttributes['class'] }
>();

const delegatedProps = reactiveOmit(props, 'class');

const forwarded = useForwardProps(delegatedProps);
</script>

<template>
  <StepperIndicator
    v-slot="slotProps"
    v-bind="forwarded"
    :class="
      cn(
        'inline-flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4',
        // 禁用状态
        'group-data-[disabled]:text-muted-foreground group-data-[disabled]:opacity-50',
        // 当前步骤
        'group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground',
        // 已完成步骤
        'group-data-[state=completed]:bg-accent group-data-[state=completed]:text-accent-foreground',
        props.class,
      )
    "
  >
    <slot v-bind="slotProps" />
  </StepperIndicator>
</template>
