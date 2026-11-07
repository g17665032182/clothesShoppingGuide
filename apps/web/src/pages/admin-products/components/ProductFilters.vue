<script setup lang="ts">
import { RefreshCw, Search } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AdminProductCategory } from '@/api/types/admin-products';

defineProps<{
  keyword: string;
  category: AdminProductCategory | 'all';
  isActive: 'all' | 'true' | 'false';
  inStock: 'all' | 'true' | 'false';
  loading: boolean;
  categories: Array<{ value: AdminProductCategory; label: string }>;
}>();

const emit = defineEmits<{
  (event: 'update:keyword', value: string): void;
  (event: 'update:category', value: AdminProductCategory | 'all'): void;
  (event: 'update:isActive', value: 'all' | 'true' | 'false'): void;
  (event: 'update:inStock', value: 'all' | 'true' | 'false'): void;
  (event: 'refresh'): void;
}>();

function setCategory(value: unknown) {
  if (value === 'all' || typeof value === 'string') {
    emit('update:category', value as AdminProductCategory | 'all');
  }
}

function setBoolean(
  value: unknown,
  event: 'update:isActive' | 'update:inStock',
) {
  if (value === 'all' || value === 'true' || value === 'false') {
    if (event === 'update:isActive') emit('update:isActive', value);
    else emit('update:inStock', value);
  }
}
</script>

<template>
  <FieldGroup class="flex flex-col gap-3 xl:flex-row xl:items-end">
    <Field class="min-w-0 flex-1 xl:max-w-md">
      <FieldLabel for="admin-product-keyword" class="sr-only"
        >搜索商品</FieldLabel
      >
      <InputGroup>
        <InputGroupInput
          id="admin-product-keyword"
          :model-value="keyword"
          maxlength="160"
          placeholder="搜索商品名称、品牌或外部 ID"
          @update:model-value="emit('update:keyword', String($event))"
        />
        <InputGroupAddon><Search /></InputGroupAddon>
      </InputGroup>
    </Field>
    <Field class="xl:w-36">
      <FieldLabel class="sr-only">商品分类</FieldLabel>
      <Select :model-value="category" @update:model-value="setCategory">
        <SelectTrigger class="w-full xl:w-36" aria-label="商品分类">
          <SelectValue placeholder="全部分类" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">全部分类</SelectItem>
            <SelectItem
              v-for="item in categories"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    <Field class="xl:w-32">
      <FieldLabel class="sr-only">商品状态</FieldLabel>
      <Select
        :model-value="isActive"
        @update:model-value="setBoolean($event, 'update:isActive')"
      >
        <SelectTrigger class="w-full xl:w-32" aria-label="商品状态">
          <SelectValue placeholder="全部状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="true">已启用</SelectItem>
            <SelectItem value="false">已停用</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    <Field class="xl:w-32">
      <FieldLabel class="sr-only">库存状态</FieldLabel>
      <Select
        :model-value="inStock"
        @update:model-value="setBoolean($event, 'update:inStock')"
      >
        <SelectTrigger class="w-full xl:w-32" aria-label="库存状态">
          <SelectValue placeholder="全部库存" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">全部库存</SelectItem>
            <SelectItem value="true">可售</SelectItem>
            <SelectItem value="false">无货</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    <Button
      :disabled="loading"
      size="sm"
      variant="outline"
      @click="emit('refresh')"
    >
      <RefreshCw data-icon="inline-start" />
      刷新
    </Button>
  </FieldGroup>
</template>
