<script setup lang="ts">
import { computed, useId } from 'vue';
import { Save, X } from '@lucide/vue';
import type { PreferenceEditorState } from '../use-preferences';
import {
  fitPresets,
  garmentPresets,
  itemLimit,
  itemPresets,
  systemPresets,
  textPresets,
  widthPresets,
} from '../preference-options';
import PresetTextInput from './PresetTextInput.vue';
import PreferenceItemsInput from './PreferenceItemsInput.vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';

const props = defineProps<{
  modelValue: PreferenceEditorState;
  pending: boolean;
  error: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: PreferenceEditorState];
  submit: [];
  cancel: [];
}>();
const id = useId();
const presets = computed(() => itemPresets[props.modelValue.category] ?? []);
const itemsLabel = computed(() => {
  switch (props.modelValue.category) {
    case 'style':
      return '风格';
    case 'occasion':
      return '穿着场景';
    case 'color':
      return '颜色';
    case 'avoidance':
      return '避开内容';
    default:
      return '购买偏好';
  }
});
const sizePresets = textPresets(['XS', 'S', 'M', 'L', 'XL', 'XXL', '均码']);
const shoePresets = textPresets([
  '35',
  '36',
  '37',
  '38',
  '39',
  '40',
  '41',
  '42',
  '43',
  '44',
]);
const budgetPresets = textPresets([
  '0',
  '100',
  '300',
  '500',
  '1000',
  '2000',
  '5000',
]);
const notePresets = textPresets([
  '方便活动',
  '适合叠穿',
  '优先舒适',
  '面料亲肤',
]);

function setField<Key extends keyof PreferenceEditorState>(
  field: Key,
  value: PreferenceEditorState[Key],
) {
  emit('update:modelValue', { ...props.modelValue, [field]: value });
}
</script>

<template>
  <form
    class="flex min-w-0 flex-col gap-6"
    :aria-invalid="Boolean(error)"
    :aria-describedby="error ? `${id}-error` : undefined"
    @submit.prevent="emit('submit')"
  >
    <FieldGroup>
      <Field>
        <FieldLabel :for="`${id}-category`">类别</FieldLabel>
        <NativeSelect
          :id="`${id}-category`"
          :model-value="modelValue.category"
          :disabled="pending"
          @update:model-value="
            setField(
              'category',
              String($event) as PreferenceEditorState['category'],
            )
          "
        >
          <NativeSelectOption value="size">服装尺码</NativeSelectOption>
          <NativeSelectOption value="shoe_size">鞋码</NativeSelectOption>
          <NativeSelectOption value="fit">版型</NativeSelectOption>
          <NativeSelectOption value="style">风格</NativeSelectOption>
          <NativeSelectOption value="color">颜色</NativeSelectOption>
          <NativeSelectOption value="occasion">穿着场景</NativeSelectOption>
          <NativeSelectOption value="budget">预算</NativeSelectOption>
          <NativeSelectOption value="avoidance">避开偏好</NativeSelectOption>
          <NativeSelectOption value="purchase_preference"
            >购买偏好</NativeSelectOption
          >
        </NativeSelect>
      </Field>

      <FieldGroup
        v-if="modelValue.category === 'size'"
        class="grid gap-4 sm:grid-cols-3"
      >
        <Field>
          <FieldLabel :for="`${id}-garment`">服装类型</FieldLabel>
          <PresetTextInput
            :id="`${id}-garment`"
            :model-value="modelValue.garment"
            :presets="garmentPresets"
            :disabled="pending"
            @update:model-value="setField('garment', $event)"
          />
        </Field>
        <Field>
          <FieldLabel :for="`${id}-size`">尺码</FieldLabel>
          <PresetTextInput
            :id="`${id}-size`"
            :model-value="modelValue.label"
            :presets="sizePresets"
            :disabled="pending"
            placeholder="例如：L 或 165/88A"
            @update:model-value="setField('label', $event)"
          />
        </Field>
        <Field>
          <FieldLabel :for="`${id}-system`">尺码体系</FieldLabel>
          <PresetTextInput
            :id="`${id}-system`"
            :model-value="modelValue.sizeSystem"
            :presets="systemPresets"
            :disabled="pending"
            @update:model-value="setField('sizeSystem', $event)"
          />
        </Field>
      </FieldGroup>

      <FieldGroup
        v-else-if="modelValue.category === 'shoe_size'"
        class="grid gap-4 sm:grid-cols-3"
      >
        <Field>
          <FieldLabel :for="`${id}-shoe`">鞋码</FieldLabel>
          <PresetTextInput
            :id="`${id}-shoe`"
            type="number"
            :min="20"
            :max="60"
            :step="0.5"
            :model-value="modelValue.shoeSize"
            :presets="shoePresets"
            :disabled="pending"
            placeholder="例如：38"
            @update:model-value="setField('shoeSize', $event)"
          />
        </Field>
        <Field>
          <FieldLabel :for="`${id}-shoe-system`">尺码体系</FieldLabel>
          <PresetTextInput
            :id="`${id}-shoe-system`"
            :model-value="modelValue.shoeSystem"
            :presets="systemPresets"
            :disabled="pending"
            @update:model-value="setField('shoeSystem', $event)"
          />
        </Field>
        <Field>
          <FieldLabel :for="`${id}-width`">鞋宽</FieldLabel>
          <PresetTextInput
            :id="`${id}-width`"
            :model-value="modelValue.shoeWidth"
            :presets="widthPresets"
            :disabled="pending"
            @update:model-value="setField('shoeWidth', $event)"
          />
        </Field>
      </FieldGroup>

      <FieldGroup
        v-else-if="modelValue.category === 'fit'"
        class="grid gap-4 sm:grid-cols-2"
      >
        <Field>
          <FieldLabel :for="`${id}-fit`">版型偏好</FieldLabel>
          <PresetTextInput
            :id="`${id}-fit`"
            :model-value="modelValue.fitPreference"
            :presets="fitPresets"
            :disabled="pending"
            @update:model-value="setField('fitPreference', $event)"
          />
        </Field>
        <Field>
          <FieldLabel :for="`${id}-notes`">补充说明</FieldLabel>
          <PresetTextInput
            :id="`${id}-notes`"
            :model-value="modelValue.fitNotes"
            :presets="notePresets"
            :maxlength="80"
            :disabled="pending"
            placeholder="可选"
            @update:model-value="setField('fitNotes', $event)"
          />
        </Field>
      </FieldGroup>

      <FieldGroup
        v-else-if="modelValue.category === 'budget'"
        class="grid gap-4 sm:grid-cols-3"
      >
        <Field>
          <FieldLabel :for="`${id}-currency`">货币</FieldLabel>
          <NativeSelect
            :id="`${id}-currency`"
            :model-value="modelValue.currency"
            :disabled="pending"
            @update:model-value="
              setField(
                'currency',
                String($event) as PreferenceEditorState['currency'],
              )
            "
          >
            <NativeSelectOption value="CNY">人民币</NativeSelectOption>
            <NativeSelectOption value="USD">美元</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel :for="`${id}-min`">最低预算</FieldLabel>
          <PresetTextInput
            :id="`${id}-min`"
            type="number"
            :min="0"
            :step="1"
            :model-value="modelValue.budgetMin"
            :presets="budgetPresets"
            :disabled="pending"
            placeholder="不限"
            @update:model-value="setField('budgetMin', $event)"
          />
        </Field>
        <Field>
          <FieldLabel :for="`${id}-max`">最高预算</FieldLabel>
          <PresetTextInput
            :id="`${id}-max`"
            type="number"
            :min="0"
            :step="1"
            :model-value="modelValue.budgetMax"
            :presets="budgetPresets"
            :disabled="pending"
            placeholder="不限"
            @update:model-value="setField('budgetMax', $event)"
          />
        </Field>
      </FieldGroup>

      <template v-else>
        <Field v-if="modelValue.category === 'color'">
          <FieldLabel :for="`${id}-color-mode`">偏好类型</FieldLabel>
          <NativeSelect
            :id="`${id}-color-mode`"
            :model-value="modelValue.colorMode"
            :disabled="pending"
            @update:model-value="
              setField(
                'colorMode',
                String($event) as PreferenceEditorState['colorMode'],
              )
            "
          >
            <NativeSelectOption value="prefer">喜欢</NativeSelectOption>
            <NativeSelectOption value="avoid">避免</NativeSelectOption>
          </NativeSelect>
        </Field>
        <PreferenceItemsInput
          :key="modelValue.category"
          :model-value="modelValue.items"
          :presets="presets"
          :label="itemsLabel"
          :limit="itemLimit(modelValue.category)"
          :disabled="pending"
          @update:model-value="setField('items', $event)"
        />
        <Field v-if="modelValue.category === 'avoidance'">
          <FieldLabel :for="`${id}-reason`">原因</FieldLabel>
          <PresetTextInput
            :id="`${id}-reason`"
            :model-value="modelValue.avoidanceReason"
            :presets="notePresets"
            :maxlength="80"
            :disabled="pending"
            placeholder="可选"
            @update:model-value="setField('avoidanceReason', $event)"
          />
        </Field>
      </template>

      <Field orientation="horizontal">
        <Checkbox
          :id="`${id}-primary`"
          :model-value="modelValue.isPrimary"
          :disabled="pending"
          @update:model-value="setField('isPrimary', $event === true)"
        />
        <FieldLabel :for="`${id}-primary`">设为主要偏好</FieldLabel>
      </Field>
    </FieldGroup>

    <p
      v-if="error"
      :id="`${id}-error`"
      role="alert"
      class="text-sm text-destructive"
    >
      {{ error }}
    </p>
    <div class="flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        :disabled="pending"
        @click="emit('cancel')"
      >
        <X data-icon="inline-start" />取消
      </Button>
      <Button type="submit" :disabled="pending">
        <Spinner v-if="pending" data-icon="inline-start" />
        <Save v-else data-icon="inline-start" />
        {{ pending ? '保存中' : '保存' }}
      </Button>
    </div>
  </form>
</template>
