<script setup lang="ts">
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from '@lucide/vue';

import MemoryEditor from './components/MemoryEditor.vue';
import MemoryDocument from './components/MemoryDocument.vue';
import { useMemoriesPage } from './page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  canGoBack,
  canGoForward,
  cancelEdit,
  changeCategory,
  changePage,
  categoryLabel,
  deleteAllDialogOpen,
  deletingAll,
  deletingId,
  editor,
  editorOpen,
  editingTitle,
  enabled,
  error,
  formatMemoryValue,
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
  <section class="flex flex-col gap-7 py-8 md:py-12">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium text-muted-foreground">账户</p>
        <h1 class="text-3xl font-semibold tracking-tight">我的记忆</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          :disabled="settingPending"
          @click="toggleEnabled(!enabled)"
        >
          <span
            class="size-2 rounded-full"
            :class="enabled ? 'bg-emerald-600' : 'bg-muted-foreground'"
          />
          {{ enabled ? '记忆已开启' : '记忆已关闭' }}
        </Button>
      </div>
    </header>

    <!-- 隐藏时保留面板实例，避免切换选项卡丢失未保存的文档草稿。 -->
    <Tabs v-model="activeView" :unmount-on-hide="false" class="gap-6">
      <TabsList aria-label="记忆类型">
        <TabsTrigger value="preferences">用户偏好</TabsTrigger>
        <TabsTrigger value="document">记忆</TabsTrigger>
      </TabsList>
      <TabsContent value="document">
        <MemoryDocument />
      </TabsContent>
      <TabsContent value="preferences">
        <div class="flex flex-col gap-7">
          <p class="text-sm text-muted-foreground">{{ total }} 条偏好</p>
          <p v-if="submitError" role="alert" class="text-sm text-destructive">
            {{ submitError }}
          </p>

          <div
            class="flex flex-wrap items-center justify-between gap-3 border-y py-3"
          >
            <label class="flex items-center gap-2 text-sm font-medium">
              类别
              <NativeSelect
                class="min-w-44"
                :model-value="selectedCategory"
                @update:model-value="
                  changeCategory(String($event) as typeof selectedCategory)
                "
              >
                <NativeSelectOption value="">全部</NativeSelectOption>
                <NativeSelectOption
                  v-for="category in memoryCategories"
                  :key="category.value"
                  :value="category.value"
                >
                  {{ category.label }}
                </NativeSelectOption>
              </NativeSelect>
            </label>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                v-if="total > 0"
                variant="ghost"
                class="text-destructive hover:text-destructive"
                :disabled="deletingAll || deletingId !== null"
                @click="deleteAllDialogOpen = true"
              >
                <Trash2 data-icon="inline-start" />
                删除全部
              </Button>
              <Button
                variant="outline"
                :disabled="status === 'loading'"
                @click="loadMemories(1)"
              >
                <RefreshCw data-icon="inline-start" />
                刷新
              </Button>
              <Button @click="startCreate">
                <Plus data-icon="inline-start" />
                添加偏好
              </Button>
            </div>
          </div>

          <div
            v-if="status === 'loading' && records.length === 0"
            class="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"
            role="status"
          >
            <Spinner />
            正在加载
          </div>

          <div
            v-else-if="status === 'error'"
            class="flex flex-col items-center gap-3 py-12 text-center"
            role="alert"
          >
            <AlertTriangle class="size-6 text-destructive" />
            <p class="text-sm text-destructive">{{ error }}</p>
            <Button variant="outline" @click="loadMemories(1)">
              <RefreshCw data-icon="inline-start" />
              重试
            </Button>
          </div>

          <div
            v-else-if="status === 'empty'"
            class="flex flex-col items-center gap-3 py-14 text-center"
          >
            <div class="grid size-11 place-items-center rounded-full bg-muted">
              <Star class="size-5 text-muted-foreground" />
            </div>
            <h2 class="font-medium">还没有偏好</h2>
            <p class="max-w-md text-sm text-muted-foreground">
              {{
                selectedCategory
                  ? '这个类别暂时没有记录。'
                  : '添加一条你希望后续导购参考的偏好。'
              }}
            </p>
            <Button variant="outline" @click="startCreate">
              <Plus data-icon="inline-start" />
              添加偏好
            </Button>
          </div>

          <div v-else class="divide-y">
            <article
              v-for="memory in records"
              :key="memory.id"
              class="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="font-medium">
                    {{ categoryLabel(memory.category) }}
                  </h2>
                  <span
                    v-if="memory.isPrimary"
                    class="inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
                  >
                    <Star class="size-3" />
                    主要
                  </span>
                </div>
                <p class="mt-1 break-words text-sm">
                  {{ formatMemoryValue(memory) }}
                </p>
                <div
                  class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
                >
                  <span
                    >更新于
                    {{
                      new Date(memory.updatedAt).toLocaleDateString('zh-CN')
                    }}</span
                  >
                  <span v-if="memory.source?.status === 'deleted'"
                    >原聊天已删除</span
                  >
                  <span v-else-if="memory.source?.status === 'unavailable'"
                    >来源不可用</span
                  >
                </div>
              </div>
              <div class="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  :aria-label="`编辑${categoryLabel(memory.category)}`"
                  :title="`编辑${categoryLabel(memory.category)}`"
                  :disabled="deletingId !== null || deletingAll"
                  @click="startEdit(memory)"
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="text-destructive hover:text-destructive"
                  :aria-label="`删除${categoryLabel(memory.category)}`"
                  :title="`删除${categoryLabel(memory.category)}`"
                  :disabled="deletingId === memory.id || deletingAll"
                  @click="removeMemory(memory.id)"
                >
                  <Spinner v-if="deletingId === memory.id" />
                  <Trash2 v-else />
                </Button>
              </div>
            </article>

            <footer
              class="flex items-center justify-between gap-3 py-4 text-sm"
            >
              <span class="text-muted-foreground">
                第 {{ page }} / {{ Math.max(totalPages, 1) }} 页
              </span>
              <div class="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="上一页"
                  :disabled="!canGoBack"
                  @click="changePage(page - 1)"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
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
      </TabsContent>
    </Tabs>
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
