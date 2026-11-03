import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import {
  createMemory,
  deleteAllMemories,
  deleteMemory,
  listMemories,
  updateMemory,
  updateMemorySettings,
} from '@/api/modules/memories';
import type {
  CreateMemoryPayload,
  MemoryCategory,
  MemoryRecord,
  MemoryValue,
  UpdateMemoryPayload,
} from '@/api/types/memories';
import { auth } from '@/lib/auth';

export type MemoryPageStatus =
  'idle' | 'loading' | 'success' | 'empty' | 'error';

export type MemoryEditorState = {
  category: MemoryCategory;
  isPrimary: boolean;
  garment: 'top' | 'bottom' | 'dress' | 'outerwear' | 'unknown';
  label: string;
  sizeSystem: 'CN' | 'US' | 'EU' | 'UK' | 'INT' | 'OTHER';
  shoeSize: string;
  shoeSystem: 'CN' | 'US' | 'EU' | 'UK';
  shoeWidth: 'narrow' | 'regular' | 'wide';
  fitPreference: 'loose' | 'regular' | 'slim';
  fitNotes: string;
  items: string;
  colorMode: 'prefer' | 'avoid';
  currency: 'CNY' | 'USD';
  budgetMin: string;
  budgetMax: string;
  avoidanceReason: string;
};

const pageSize = 20;

export const memoryCategories: Array<{
  value: MemoryCategory;
  label: string;
}> = [
  { value: 'size', label: '服装尺码' },
  { value: 'shoe_size', label: '鞋码' },
  { value: 'fit', label: '版型' },
  { value: 'style', label: '风格' },
  { value: 'color', label: '颜色' },
  { value: 'occasion', label: '穿着场景' },
  { value: 'budget', label: '预算' },
  { value: 'avoidance', label: '避开偏好' },
  { value: 'purchase_preference', label: '购买偏好' },
];

export function createEmptyMemoryEditor(): MemoryEditorState {
  return {
    category: 'size',
    isPrimary: false,
    garment: 'top',
    label: '',
    sizeSystem: 'CN',
    shoeSize: '',
    shoeSystem: 'CN',
    shoeWidth: 'regular',
    fitPreference: 'loose',
    fitNotes: '',
    items: '',
    colorMode: 'prefer',
    currency: 'CNY',
    budgetMin: '',
    budgetMax: '',
    avoidanceReason: '',
  };
}

function splitItems(value: string): string[] {
  return [...new Set(value.split(/[,，、\n]/u).map((item) => item.trim()))]
    .filter(Boolean)
    .slice(0, 8);
}

export function editorToValue(editor: MemoryEditorState): MemoryValue | null {
  const items = splitItems(editor.items);
  switch (editor.category) {
    case 'size':
      return editor.label.trim()
        ? {
            garment: editor.garment,
            label: editor.label.trim(),
            ...(editor.sizeSystem ? { system: editor.sizeSystem } : {}),
          }
        : null;
    case 'shoe_size': {
      const value = Number(editor.shoeSize);
      return Number.isFinite(value)
        ? {
            value,
            system: editor.shoeSystem,
            width: editor.shoeWidth,
          }
        : null;
    }
    case 'fit':
      return {
        preference: editor.fitPreference,
        ...(editor.fitNotes.trim() ? { notes: editor.fitNotes.trim() } : {}),
      };
    case 'style':
    case 'occasion':
    case 'purchase_preference':
      return items.length ? { items } : null;
    case 'color':
      return items.length ? { mode: editor.colorMode, items } : null;
    case 'budget': {
      const min =
        editor.budgetMin.trim() === '' ? undefined : Number(editor.budgetMin);
      const max =
        editor.budgetMax.trim() === '' ? undefined : Number(editor.budgetMax);
      if (
        (min === undefined && max === undefined) ||
        (min !== undefined && !Number.isInteger(min)) ||
        (max !== undefined && !Number.isInteger(max)) ||
        (min !== undefined && min < 0) ||
        (max !== undefined && max < 0) ||
        (min !== undefined && max !== undefined && min > max)
      ) {
        return null;
      }
      return {
        currency: editor.currency,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
    case 'avoidance':
      return items.length
        ? {
            terms: items,
            ...(editor.avoidanceReason.trim()
              ? { reason: editor.avoidanceReason.trim() }
              : {}),
          }
        : null;
  }
}

function editorFromMemory(memory: MemoryRecord): MemoryEditorState {
  const editor = createEmptyMemoryEditor();
  const value = memory.value as Record<string, unknown>;
  editor.category = memory.category;
  editor.isPrimary = memory.isPrimary;

  if (memory.category === 'size') {
    editor.garment = value.garment as MemoryEditorState['garment'];
    editor.label = String(value.label ?? '');
    editor.sizeSystem =
      (value.system as MemoryEditorState['sizeSystem']) ?? 'CN';
  } else if (memory.category === 'shoe_size') {
    editor.shoeSize = String(value.value ?? '');
    editor.shoeSystem = value.system as MemoryEditorState['shoeSystem'];
    editor.shoeWidth =
      (value.width as MemoryEditorState['shoeWidth']) ?? 'regular';
  } else if (memory.category === 'fit') {
    editor.fitPreference =
      value.preference as MemoryEditorState['fitPreference'];
    editor.fitNotes = String(value.notes ?? '');
  } else if (memory.category === 'budget') {
    editor.currency = value.currency as MemoryEditorState['currency'];
    editor.budgetMin = value.min === undefined ? '' : String(value.min);
    editor.budgetMax = value.max === undefined ? '' : String(value.max);
  } else if (memory.category === 'color') {
    editor.colorMode = value.mode as MemoryEditorState['colorMode'];
    editor.items = Array.isArray(value.items) ? value.items.join('、') : '';
  } else if (memory.category === 'avoidance') {
    editor.items = Array.isArray(value.terms) ? value.terms.join('、') : '';
    editor.avoidanceReason = String(value.reason ?? '');
  } else {
    editor.items = Array.isArray(value.items) ? value.items.join('、') : '';
  }
  return editor;
}

function categoryLabel(category: MemoryCategory): string {
  return memoryCategories.find((item) => item.value === category)?.label ?? '';
}

export function formatMemoryValue(memory: MemoryRecord): string {
  const value = memory.value as Record<string, unknown>;
  if (memory.category === 'size') {
    return `${categoryLabel(memory.category)} · ${String(value.label)}${value.system ? ` ${String(value.system)}` : ''}`;
  }
  if (memory.category === 'shoe_size') {
    return `${String(value.value)} ${String(value.system)} · ${String(value.width ?? 'regular')}`;
  }
  if (memory.category === 'fit') {
    return `${String(value.preference)}${value.notes ? ` · ${String(value.notes)}` : ''}`;
  }
  if (memory.category === 'budget') {
    const minimum = value.min === undefined ? '不限' : String(value.min);
    const maximum = value.max === undefined ? '不限' : String(value.max);
    return `${minimum} - ${maximum} ${String(value.currency)}`;
  }
  if (memory.category === 'avoidance') {
    return `${(value.terms as string[]).join('、')}${value.reason ? ` · ${String(value.reason)}` : ''}`;
  }
  const items = Array.isArray(value.items) ? value.items.join('、') : '';
  return memory.category === 'color'
    ? `${value.mode === 'avoid' ? '避免' : '偏好'}${items}`
    : items;
}

export function useMemoriesPage() {
  const activeView = ref<'preferences' | 'document'>('preferences');
  const records = ref<MemoryRecord[]>([]);
  const status = ref<MemoryPageStatus>('idle');
  const error = ref('');
  const submitError = ref('');
  const page = ref(1);
  const total = ref(0);
  const totalPages = ref(0);
  const selectedCategory = ref<MemoryCategory | ''>('');
  const enabled = ref(true);
  const settingPending = ref(false);
  const editorOpen = ref(false);
  const editingId = ref<string | null>(null);
  const editor = ref<MemoryEditorState>(createEmptyMemoryEditor());
  const submitting = ref(false);
  const deletingId = ref<string | null>(null);
  const deletingAll = ref(false);
  const deleteAllDialogOpen = ref(false);
  let loadController: AbortController | null = null;
  let loadVersion = 0;
  let unmounted = false;

  const busy = computed(
    () =>
      submitting.value ||
      deletingId.value !== null ||
      deletingAll.value ||
      settingPending.value,
  );
  const canGoBack = computed(
    () => page.value > 1 && status.value !== 'loading',
  );
  const canGoForward = computed(
    () => page.value < totalPages.value && status.value !== 'loading',
  );
  const editingTitle = computed(() =>
    editingId.value ? '编辑偏好' : '添加偏好',
  );

  async function loadMemories(targetPage = page.value) {
    const token = auth.state.token;
    if (!token || unmounted) return;

    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const version = ++loadVersion;
    status.value = 'loading';
    error.value = '';
    try {
      const response = await listMemories(token, {
        page: targetPage,
        pageSize,
        ...(selectedCategory.value ? { category: selectedCategory.value } : {}),
        signal: controller.signal,
      });
      if (unmounted || version !== loadVersion) return;
      records.value = response.items;
      enabled.value = response.settings.enabled;
      page.value = response.page;
      total.value = response.total;
      totalPages.value = response.totalPages;
      status.value = response.items.length > 0 ? 'success' : 'empty';
    } catch (cause) {
      if (controller.signal.aborted || unmounted || version !== loadVersion)
        return;
      status.value = 'error';
      error.value =
        cause instanceof Error ? cause.message : '记忆列表加载失败。';
    } finally {
      if (version === loadVersion) loadController = null;
    }
  }

  function startCreate() {
    editingId.value = null;
    editor.value = createEmptyMemoryEditor();
    submitError.value = '';
    editorOpen.value = true;
  }

  function startEdit(memory: MemoryRecord) {
    editingId.value = memory.id;
    editor.value = editorFromMemory(memory);
    submitError.value = '';
    editorOpen.value = true;
  }

  function cancelEdit() {
    if (submitting.value) return;
    editorOpen.value = false;
    editingId.value = null;
    submitError.value = '';
  }

  async function saveMemory() {
    const token = auth.state.token;
    if (!token || submitting.value) return;
    const value = editorToValue(editor.value);
    if (!value) {
      submitError.value = '请检查必填项和数值范围。';
      return;
    }

    submitting.value = true;
    submitError.value = '';
    try {
      if (editingId.value) {
        const payload: UpdateMemoryPayload = {
          category: editor.value.category,
          value,
          isPrimary: editor.value.isPrimary,
        };
        await updateMemory(token, editingId.value, payload);
      } else {
        const payload: CreateMemoryPayload = {
          category: editor.value.category,
          value,
          isPrimary: editor.value.isPrimary,
        };
        await createMemory(token, payload);
      }
      editorOpen.value = false;
      editingId.value = null;
      await loadMemories(1);
    } catch (cause) {
      submitError.value =
        cause instanceof Error ? cause.message : '保存记忆失败。';
    } finally {
      submitting.value = false;
    }
  }

  async function removeMemory(memoryId: string) {
    const token = auth.state.token;
    if (!token || deletingId.value || deletingAll.value) return;
    deletingId.value = memoryId;
    submitError.value = '';
    try {
      await deleteMemory(token, memoryId);
      if (records.value.length === 1 && page.value > 1) {
        await loadMemories(page.value - 1);
      } else {
        await loadMemories(page.value);
      }
    } catch (cause) {
      submitError.value =
        cause instanceof Error ? cause.message : '删除记忆失败。';
    } finally {
      deletingId.value = null;
    }
  }

  async function removeAllMemories() {
    const token = auth.state.token;
    if (!token || deletingAll.value || total.value === 0) return;
    deletingAll.value = true;
    submitError.value = '';
    try {
      await deleteAllMemories(token);
      deleteAllDialogOpen.value = false;
      page.value = 1;
      await loadMemories(1);
    } catch (cause) {
      submitError.value =
        cause instanceof Error ? cause.message : '删除全部记忆失败。';
    } finally {
      deletingAll.value = false;
    }
  }

  async function toggleEnabled(nextEnabled: boolean) {
    const token = auth.state.token;
    if (!token || settingPending.value || nextEnabled === enabled.value) return;
    settingPending.value = true;
    submitError.value = '';
    try {
      const settings = await updateMemorySettings(token, nextEnabled);
      enabled.value = settings.enabled;
    } catch (cause) {
      submitError.value =
        cause instanceof Error ? cause.message : '更新记忆设置失败。';
    } finally {
      settingPending.value = false;
    }
  }

  function changeCategory(category: MemoryCategory | '') {
    selectedCategory.value = category;
    page.value = 1;
    void loadMemories(1);
  }

  function changePage(nextPage: number) {
    if (
      nextPage < 1 ||
      nextPage > totalPages.value ||
      status.value === 'loading'
    )
      return;
    void loadMemories(nextPage);
  }

  onMounted(() => {
    void loadMemories(1);
  });

  onBeforeUnmount(() => {
    unmounted = true;
    loadVersion += 1;
    loadController?.abort();
    loadController = null;
  });

  return {
    activeView,
    busy,
    canGoBack,
    canGoForward,
    changeCategory,
    changePage,
    categoryLabel,
    deleteAllDialogOpen,
    deletingAll,
    deletingId,
    editor,
    editorOpen,
    editingId,
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
    cancelEdit,
    toggleEnabled,
    total,
    totalPages,
    settingPending,
  };
}
