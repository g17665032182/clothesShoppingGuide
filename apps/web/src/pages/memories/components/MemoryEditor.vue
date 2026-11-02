<script setup lang="ts">
import { Save, X } from '@lucide/vue';

import type { MemoryEditorState } from '../page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';

const props = defineProps<{
  modelValue: MemoryEditorState;
  title: string;
  pending: boolean;
  error: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: MemoryEditorState];
  submit: [];
  cancel: [];
}>();

function setField<Key extends keyof MemoryEditorState>(
  field: Key,
  value: MemoryEditorState[Key],
) {
  emit('update:modelValue', { ...props.modelValue, [field]: value });
}
</script>

<template>
  <form class="flex flex-col gap-5" @submit.prevent="emit('submit')">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          仅填写与服装选择有关的偏好。
        </p>
      </div>
      <label class="flex min-h-8 items-center gap-2 text-sm">
        <input
          type="checkbox"
          :checked="modelValue.isPrimary"
          :disabled="pending"
          @change="
            setField('isPrimary', ($event.target as HTMLInputElement).checked)
          "
        />
        设为主要偏好
      </label>
    </div>

    <label class="grid gap-1.5 text-sm font-medium">
      类别
      <NativeSelect
        :model-value="modelValue.category"
        :disabled="pending"
        @update:model-value="
          setField('category', String($event) as MemoryEditorState['category'])
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
    </label>

    <div
      v-if="modelValue.category === 'size'"
      class="grid gap-4 sm:grid-cols-3"
    >
      <label class="grid gap-1.5 text-sm font-medium">
        服装类型
        <NativeSelect
          :model-value="modelValue.garment"
          :disabled="pending"
          @update:model-value="
            setField('garment', String($event) as MemoryEditorState['garment'])
          "
        >
          <NativeSelectOption value="top">上装</NativeSelectOption>
          <NativeSelectOption value="bottom">下装</NativeSelectOption>
          <NativeSelectOption value="dress">连衣裙</NativeSelectOption>
          <NativeSelectOption value="outerwear">外套</NativeSelectOption>
          <NativeSelectOption value="unknown">未指定</NativeSelectOption>
        </NativeSelect>
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        尺码
        <Input
          :model-value="modelValue.label"
          maxlength="32"
          placeholder="例如：L"
          :disabled="pending"
          @update:model-value="setField('label', String($event))"
        />
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        尺码体系
        <NativeSelect
          :model-value="modelValue.sizeSystem"
          :disabled="pending"
          @update:model-value="
            setField(
              'sizeSystem',
              String($event) as MemoryEditorState['sizeSystem'],
            )
          "
        >
          <NativeSelectOption value="CN">CN</NativeSelectOption>
          <NativeSelectOption value="US">US</NativeSelectOption>
          <NativeSelectOption value="EU">EU</NativeSelectOption>
          <NativeSelectOption value="UK">UK</NativeSelectOption>
          <NativeSelectOption value="INT">INT</NativeSelectOption>
          <NativeSelectOption value="OTHER">其他</NativeSelectOption>
        </NativeSelect>
      </label>
    </div>

    <div
      v-else-if="modelValue.category === 'shoe_size'"
      class="grid gap-4 sm:grid-cols-3"
    >
      <label class="grid gap-1.5 text-sm font-medium">
        鞋码
        <Input
          type="number"
          min="20"
          max="60"
          step="0.5"
          :model-value="modelValue.shoeSize"
          placeholder="例如：38"
          :disabled="pending"
          @update:model-value="setField('shoeSize', String($event))"
        />
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        尺码体系
        <NativeSelect
          :model-value="modelValue.shoeSystem"
          :disabled="pending"
          @update:model-value="
            setField(
              'shoeSystem',
              String($event) as MemoryEditorState['shoeSystem'],
            )
          "
        >
          <NativeSelectOption value="CN">CN</NativeSelectOption>
          <NativeSelectOption value="US">US</NativeSelectOption>
          <NativeSelectOption value="EU">EU</NativeSelectOption>
          <NativeSelectOption value="UK">UK</NativeSelectOption>
        </NativeSelect>
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        鞋宽
        <NativeSelect
          :model-value="modelValue.shoeWidth"
          :disabled="pending"
          @update:model-value="
            setField(
              'shoeWidth',
              String($event) as MemoryEditorState['shoeWidth'],
            )
          "
        >
          <NativeSelectOption value="narrow">偏窄</NativeSelectOption>
          <NativeSelectOption value="regular">标准</NativeSelectOption>
          <NativeSelectOption value="wide">偏宽</NativeSelectOption>
        </NativeSelect>
      </label>
    </div>

    <div
      v-else-if="modelValue.category === 'fit'"
      class="grid gap-4 sm:grid-cols-2"
    >
      <label class="grid gap-1.5 text-sm font-medium">
        版型偏好
        <NativeSelect
          :model-value="modelValue.fitPreference"
          :disabled="pending"
          @update:model-value="
            setField(
              'fitPreference',
              String($event) as MemoryEditorState['fitPreference'],
            )
          "
        >
          <NativeSelectOption value="loose">宽松</NativeSelectOption>
          <NativeSelectOption value="regular">合身</NativeSelectOption>
          <NativeSelectOption value="slim">修身</NativeSelectOption>
        </NativeSelect>
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        补充说明
        <Input
          :model-value="modelValue.fitNotes"
          maxlength="80"
          placeholder="可选"
          :disabled="pending"
          @update:model-value="setField('fitNotes', String($event))"
        />
      </label>
    </div>

    <div
      v-else-if="modelValue.category === 'color'"
      class="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]"
    >
      <label class="grid gap-1.5 text-sm font-medium">
        偏好类型
        <NativeSelect
          :model-value="modelValue.colorMode"
          :disabled="pending"
          @update:model-value="
            setField(
              'colorMode',
              String($event) as MemoryEditorState['colorMode'],
            )
          "
        >
          <NativeSelectOption value="prefer">喜欢</NativeSelectOption>
          <NativeSelectOption value="avoid">避免</NativeSelectOption>
        </NativeSelect>
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        颜色
        <Input
          :model-value="modelValue.items"
          maxlength="260"
          placeholder="用顿号或逗号分隔"
          :disabled="pending"
          @update:model-value="setField('items', String($event))"
        />
      </label>
    </div>

    <div
      v-else-if="modelValue.category === 'budget'"
      class="grid gap-4 sm:grid-cols-3"
    >
      <label class="grid gap-1.5 text-sm font-medium">
        货币
        <NativeSelect
          :model-value="modelValue.currency"
          :disabled="pending"
          @update:model-value="
            setField(
              'currency',
              String($event) as MemoryEditorState['currency'],
            )
          "
        >
          <NativeSelectOption value="CNY">人民币</NativeSelectOption>
          <NativeSelectOption value="USD">美元</NativeSelectOption>
        </NativeSelect>
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        最低预算
        <Input
          type="number"
          min="0"
          step="1"
          :model-value="modelValue.budgetMin"
          placeholder="可留空"
          :disabled="pending"
          @update:model-value="setField('budgetMin', String($event))"
        />
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        最高预算
        <Input
          type="number"
          min="0"
          step="1"
          :model-value="modelValue.budgetMax"
          placeholder="可留空"
          :disabled="pending"
          @update:model-value="setField('budgetMax', String($event))"
        />
      </label>
    </div>

    <div v-else-if="modelValue.category === 'avoidance'" class="grid gap-4">
      <label class="grid gap-1.5 text-sm font-medium">
        避开内容
        <Input
          :model-value="modelValue.items"
          maxlength="260"
          placeholder="用顿号或逗号分隔"
          :disabled="pending"
          @update:model-value="setField('items', String($event))"
        />
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        原因
        <Input
          :model-value="modelValue.avoidanceReason"
          maxlength="80"
          placeholder="可选"
          :disabled="pending"
          @update:model-value="setField('avoidanceReason', String($event))"
        />
      </label>
    </div>

    <label v-else class="grid gap-1.5 text-sm font-medium">
      {{
        modelValue.category === 'style'
          ? '风格'
          : modelValue.category === 'occasion'
            ? '场景'
            : '购买偏好'
      }}
      <Input
        :model-value="modelValue.items"
        maxlength="260"
        placeholder="用顿号或逗号分隔"
        :disabled="pending"
        @update:model-value="setField('items', String($event))"
      />
    </label>

    <p v-if="error" role="alert" class="text-sm text-destructive">
      {{ error }}
    </p>

    <div class="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        :disabled="pending"
        @click="emit('cancel')"
      >
        <X data-icon="inline-start" />
        取消
      </Button>
      <Button type="submit" :disabled="pending">
        <Spinner v-if="pending" data-icon="inline-start" />
        <Save v-else data-icon="inline-start" />
        {{ pending ? '保存中' : '保存' }}
      </Button>
    </div>
  </form>
</template>
