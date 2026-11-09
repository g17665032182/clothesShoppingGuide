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

import PreferenceEditor from './components/PreferenceEditor.vue';
import MemoryDocument from './components/MemoryDocument.vue';
import PreferencesTable from './components/PreferencesTable.vue';
import { useMemoriesPage } from './page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
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
  memoryDocument,
  loadPreferences,
  preferenceCategories,
  page,
  records,
  removeAllPreferences,
  removePreference,
  savePreference,
  selectedCategory,
  startCreate,
  startEdit,
  status,
  validationError,
  submitting,
  toggleEnabled,
  total,
  totalPages,
  settingPending,
  settingsStatus,
  loadSettings,
} = useMemoriesPage();

function handleEditorOpenChange(open: boolean) {
  if (!open) cancelEdit();
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-6">
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
        <Spinner v-if="settingsStatus === 'loading'" />
        <Field orientation="horizontal">
          <Checkbox
            :id="`${activeView}-enabled`"
            :model-value="enabled === true"
            :disabled="settingPending || settingsStatus !== 'success'"
            @update:model-value="toggleEnabled($event === true)"
          />
          <FieldLabel :for="`${activeView}-enabled`">
            {{ activeView === 'document' ? '自动记忆' : '参考我的偏好' }}
          </FieldLabel>
        </Field>
        <Button
          v-if="settingsStatus === 'error'"
          variant="outline"
          size="icon"
          aria-label="重新读取设置"
          title="重新读取设置"
          @click="loadSettings"
          ><RefreshCw
        /></Button>
      </div>
    </header>

    <!-- 菜单切换只停用文档实例，保留未保存的草稿。 -->
    <KeepAlive>
      <MemoryDocument
        v-if="activeView === 'document'"
        :state="memoryDocument"
        @update:draft="memoryDocument.updateDraft"
        @update:preview="memoryDocument.preview = $event"
        @update:clear-open="memoryDocument.clearOpen = $event"
        @load="memoryDocument.loadDocument"
        @save="memoryDocument.save"
        @clear="memoryDocument.clearDocument"
        @use-latest="memoryDocument.useLatestAsBase"
      />
    </KeepAlive>
    <div
      v-show="activeView === 'preferences'"
      class="flex min-w-0 flex-col gap-4"
    >
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
                v-for="category in preferenceCategories"
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
            @click="loadPreferences(1)"
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
          <EmptyDescription>请重新加载偏好。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" @click="loadPreferences(1)">
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
          @delete="removePreference"
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

  <Dialog
    :open="activeView === 'preferences' && editorOpen"
    @update:open="handleEditorOpenChange"
  >
    <DialogContent
      class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl"
    >
      <DialogHeader>
        <DialogTitle>{{ editingTitle }}</DialogTitle>
        <DialogDescription> 仅填写与服装选择有关的偏好。 </DialogDescription>
      </DialogHeader>
      <PreferenceEditor
        v-model="editor"
        :pending="submitting"
        :error="validationError"
        @submit="savePreference"
        @cancel="cancelEdit"
      />
    </DialogContent>
  </Dialog>

  <AlertDialog
    :open="activeView === 'preferences' && deleteAllDialogOpen"
    @update:open="deleteAllDialogOpen = $event"
  >
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
          @click.prevent="removeAllPreferences"
        >
          <Spinner v-if="deletingAll" data-icon="inline-start" />
          <Trash2 v-else data-icon="inline-start" />
          确认删除
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
