<script setup lang="ts">
import { computed, useId } from 'vue';
import {
  normalizePreferenceItems,
  presetLabel,
  type PreferenceOption,
} from '../preference-options';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';

const props = defineProps<{
  modelValue: string;
  presets: PreferenceOption[];
  label: string;
  limit: number;
  disabled: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const fieldId = useId();
const selected = computed(() =>
  normalizePreferenceItems(props.modelValue, props.presets),
);
const invalid = computed(
  () =>
    selected.value.length > props.limit ||
    selected.value.some(
      (value) => value.length > 32 || /[\u0000-\u001f]/u.test(value),
    ),
);

function toggle(value: string, checked: boolean | 'indeterminate') {
  if (props.disabled) return;
  const values = selected.value.filter((item) => item !== value);
  if (checked === true) values.push(value);
  emit(
    'update:modelValue',
    values.map((item) => presetLabel(item, props.presets)).join('、'),
  );
}
</script>

<template>
  <FieldSet class="min-w-0">
    <FieldLegend>{{ label }}</FieldLegend>
    <FieldGroup class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      <Field
        v-for="option in presets"
        :key="option.value"
        orientation="horizontal"
      >
        <Checkbox
          :id="`${fieldId}-${option.value}`"
          :model-value="selected.includes(option.value)"
          :disabled="
            disabled ||
            (!selected.includes(option.value) && selected.length >= limit)
          "
          @update:model-value="toggle(option.value, $event)"
        />
        <FieldLabel :for="`${fieldId}-${option.value}`">{{
          option.label
        }}</FieldLabel>
      </Field>
    </FieldGroup>
    <Field
      :data-invalid="invalid || undefined"
      :data-disabled="disabled || undefined"
    >
      <FieldLabel :for="`${fieldId}-custom`">自定义或补充</FieldLabel>
      <Input
        :id="`${fieldId}-custom`"
        :model-value="modelValue"
        :disabled="disabled"
        :aria-invalid="invalid || undefined"
        :aria-describedby="`${fieldId}-description`"
        placeholder="输入内容，用顿号或逗号分隔"
        @update:model-value="emit('update:modelValue', String($event))"
      />
      <FieldDescription :id="`${fieldId}-description`">
        {{ selected.length }} / {{ limit }} 项，每项最多 32 个字符
      </FieldDescription>
    </Field>
  </FieldSet>
</template>
