<script setup lang="ts">
import { useId } from 'vue';
import type { PreferenceOption } from '../preference-options';
import { Input } from '@/components/ui/input';

defineOptions({ inheritAttrs: false });
defineProps<{
  modelValue: string;
  presets: PreferenceOption[];
  disabled?: boolean;
  maxlength?: number;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const listId = useId();
</script>

<template>
  <!-- 原生候选列表保留输入框语义，可直接选择常用值或继续键入自定义值。 -->
  <Input
    v-bind="$attrs"
    :model-value="modelValue"
    :list="listId"
    :disabled="disabled"
    :maxlength="maxlength ?? 32"
    :type="type ?? 'text'"
    :min="min"
    :max="max"
    :step="step"
    :placeholder="placeholder"
    @update:model-value="emit('update:modelValue', String($event))"
  />
  <datalist :id="listId">
    <option
      v-for="option in presets"
      :key="option.value"
      :value="option.label"
    />
  </datalist>
</template>
