<script setup lang="ts">
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from '@lucide/vue';

import MemoryEditor from './components/MemoryEditor.vue';
import MemoryDocument from './components/MemoryDocument.vue';
import PreferencesTable from './components/PreferencesTable.vue';
import { useMemoriesPage } from './page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

const {
  activeView,
  busy,
  canGoBack,
  canGoForward,
  cancelEdit,
  changeCategory,
  changePage,
  deleteAllDialogOpen,
  deletingAll,
  deletingId,
  editor,
  editorOpen,
  editingTitle,
  enabled,
  error,
  loadMemories,
  memoryCategories,
  page,
  records,
  removeAllMemories,
  removeMemory,
  saveMemory,
  selectedCategory,
  startCreate,
  startEdit,
  status,
  submitError,
  submitting,
  toggleEnabled,
  total,
  totalPages,
  settingPending,
} = useMemoriesPage();

function handleEditorOpenChange(open: boolean) {
  if (!open) cancelEdit();
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-6 py-8 md:py-10">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium text-muted-foreground">账户</p>
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-semibold">
            {{ activeView === 'document' ? '我的记忆' : '我的偏好' }}
          </h1>
          <Badge v-if="activeView === 'preferences'" variant="secondary"
            >{{ total }} 条</Badge
          >
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          :disabled="settingPending"
          @click="toggleEnabled(!enabled)"
        >
          <span
            class="size-2 rounded-full"
            :class="enabled ? 'bg-primary' : 'bg-muted-foreground'"
          />
          {{ enabled ? '记忆已开启' : '记忆已关闭' }}
        </Button>
      </div>
    </header>

    <!-- 菜单切换只停用文档实例，保留未保存的草稿。 -->
    <KeepAlive>
      <MemoryDocument v-if="activeView === 'document'" />
    </KeepAlive>
    <div
      v-show="activeView === 'preferences'"
      class="flex min-w-0 flex-col gap-4"
    >
      <Alert v-if="submitError && !editorOpen" variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>操作未完成</AlertTitle>
        <AlertDescription>{{ submitError }}</AlertDescription>
      </Alert>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <FieldGroup class="w-32 shrink-0 sm:w-40">
          <Field orientation="horizontal">
            <FieldLabel for="preference-category" class="sr-only"
              >偏好类别</FieldLabel
            >
            <NativeSelect
              id="preference-category"
              class="w-full"
              :model-value="selectedCategory"
              :disabled="busy"
              @update:model-value="
                changeCategory(String($event) as typeof selectedCategory)
              "
            >
              <NativeSelectOption value="">全部类别</NativeSelectOption>
              <NativeSelectOption
                v-for="category in memoryCategories"
                :key="category.value"
                :value="category.value"
              >
                {{ category.label }}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
        </FieldGroup>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            v-if="total > 0"
            variant="ghost"
            :disabled="busy || status === 'loading'"
            size="icon"
            aria-label="删除全部偏好"
            title="删除全部偏好"
            @click="deleteAllDialogOpen = true"
          >
            <Trash2 data-icon="inline-start" />
          </Button>
          <Button
            variant="outline"
            :disabled="busy || status === 'loading'"
            size="icon"
            aria-label="刷新偏好"
            title="刷新偏好"
            @click="loadMemories(1)"
          >
            <Spinner v-if="status === 'loading'" data-icon="inline-start" />
            <RefreshCw v-else data-icon="inline-start" />
          </Button>
          <Button :disabled="busy" @click="startCreate">
            <Plus data-icon="inline-start" />
            添加偏好
          </Button>
        </div>
      </div>

      <div
        v-if="status === 'loading'"
        class="flex min-h-64 items-center justify-center gap-3 border-y text-sm text-muted-foreground"
        role="status"
      >
        <Spinner />
        正在加载偏好
      </div>

      <Empty
        v-else-if="status === 'error'"
        class="min-h-64 border-y"
        role="alert"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia>
          <EmptyTitle>偏好加载失败</EmptyTitle>
          <EmptyDescription>{{ error }}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" @click="loadMemories(1)">
            <RefreshCw data-icon="inline-start" />
            重试
          </Button>
        </EmptyContent>
      </Empty>

      <Empty v-else-if="status === 'empty'" class="min-h-64 border-y">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Star /></EmptyMedia>
          <EmptyTitle>{{
            selectedCategory ? '这个类别还没有偏好' : '还没有偏好'
          }}</EmptyTitle>
          <EmptyDescription>
            {{
              selectedCategory
                ? '可以添加一条偏好，或切换到其他类别。'
                : '记录常穿尺码、喜欢的风格和预算。'
            }}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" :disabled="busy" @click="startCreate">
            <Plus data-icon="inline-start" />
            添加偏好
          </Button>
        </EmptyContent>
      </Empty>

      <div v-else class="min-w-0 border-y">
        <PreferencesTable
          :records="records"
          :deleting-id="deletingId"
          :busy="busy"
          @edit="startEdit"
          @delete="removeMemory"
        />

        <footer
          class="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-3 text-sm sm:px-4"
        >
          <span class="text-muted-foreground"> 共 {{ total }} 条偏好 </span>
          <div class="flex gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="上一页"
              :disabled="!canGoBack"
              @click="changePage(page - 1)"
            >
              <ChevronLeft />
            </Button>
            <span
              class="flex items-center px-1 text-xs tabular-nums text-muted-foreground"
            >
              {{ page }} / {{ Math.max(totalPages, 1) }}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="下一页"
              :disabled="!canGoForward"
              @click="changePage(page + 1)"
            >
              <ChevronRight />
            </Button>
          </div>
        </footer>
      </div>
    </div>
  </section>

  <Dialog :open="editorOpen" @update:open="handleEditorOpenChange">
    <DialogContent
      class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl"
    >
      <DialogHeader>
        <DialogTitle>{{ editingTitle }}</DialogTitle>
        <DialogDescription> 仅填写与服装选择有关的偏好。 </DialogDescription>
      </DialogHeader>
      <MemoryEditor
        v-model="editor"
        :pending="submitting"
        :error="submitError"
        @submit="saveMemory"
        @cancel="cancelEdit"
      />
    </DialogContent>
  </Dialog>

  <AlertDialog v-model:open="deleteAllDialogOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>删除全部偏好？</AlertDialogTitle>
        <AlertDialogDescription>
          将删除你的 {{ total }} 条用户偏好。记忆文档和聊天记录不会受影响。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="deletingAll">取消</AlertDialogCancel>
        <AlertDialogAction
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          :disabled="deletingAll"
          @click.prevent="removeAllMemories"
        >
          <Spinner v-if="deletingAll" data-icon="inline-start" />
          <Trash2 v-else data-icon="inline-start" />
          确认删除
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
