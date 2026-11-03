import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  categoryLabel,
  formatMemoryValue,
  memoryCategories,
} from './preference-display';
export { formatMemoryValue, memoryCategories } from './preference-display';

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
import { ApiError } from '@/api';
import {
  fitPresets,
  garmentPresets,
  itemLimit,
  itemPresets,
  normalizePreferenceItems,
  presetLabel,
  presetValue,
  systemPresets,
  widthPresets,
} from './preference-options';

export type MemoryPageStatus =
  'idle' | 'loading' | 'success' | 'empty' | 'error';

export type MemoryEditorState = {
  category: MemoryCategory;
  isPrimary: boolean;
  garment: string;
  label: string;
  sizeSystem: string;
  shoeSize: string;
  shoeSystem: string;
  shoeWidth: string;
  fitPreference: string;
  fitNotes: string;
  items: string;
  colorMode: 'prefer' | 'avoid';
  currency: 'CNY' | 'USD';
  budgetMin: string;
  budgetMax: string;
  avoidanceReason: string;
};

const pageSize = 20;

export function createEmptyMemoryEditor(): MemoryEditorState {
  return {
    category: 'size',
    isPrimary: false,
    garment: '上装',
    label: '',
    sizeSystem: '中国码',
    shoeSize: '',
    shoeSystem: '中国码',
    shoeWidth: '标准鞋宽',
    fitPreference: '宽松',
    fitNotes: '',
    items: '',
    colorMode: 'prefer',
    currency: 'CNY',
    budgetMin: '',
    budgetMax: '',
    avoidanceReason: '',
  };
}

export function editorToValue(editor: MemoryEditorState): MemoryValue | null {
  if (validateMemoryEditor(editor)) return null;
  const items = normalizePreferenceItems(
    editor.items,
    itemPresets[editor.category] ?? [],
  );
  switch (editor.category) {
    case 'size':
      return editor.label.trim()
        ? {
            garment: presetValue(editor.garment, garmentPresets),
            label: editor.label.trim(),
            ...(editor.sizeSystem.trim()
              ? { system: presetValue(editor.sizeSystem, systemPresets) }
              : {}),
          }
        : null;
    case 'shoe_size': {
      const value = Number(editor.shoeSize);
      return Number.isFinite(value)
        ? {
            value,
            system: presetValue(editor.shoeSystem, systemPresets),
            ...(editor.shoeWidth.trim()
              ? { width: presetValue(editor.shoeWidth, widthPresets) }
              : {}),
          }
        : null;
    }
    case 'fit':
      return {
        preference: presetValue(editor.fitPreference, fitPresets),
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

export function validateMemoryEditor(editor: MemoryEditorState): string {
  const validText = (text: string) =>
    text.trim().length >= 1 &&
    text.trim().length <= 32 &&
    !/[\u0000-\u001f]/u.test(text.trim());
  switch (editor.category) {
    case 'size':
      return !validText(editor.garment) ||
        !validText(editor.label) ||
        (editor.sizeSystem.trim() && !validText(editor.sizeSystem))
        ? '请填写服装类型和尺码，每项不超过 32 个字符。'
        : '';
    case 'shoe_size':
      if (
        !editor.shoeSize.trim() ||
        !Number.isFinite(Number(editor.shoeSize)) ||
        Number(editor.shoeSize) < 20 ||
        Number(editor.shoeSize) > 60
      )
        return '鞋码请输入 20 到 60 之间的数字。';
      return !validText(editor.shoeSystem) ||
        (editor.shoeWidth.trim() && !validText(editor.shoeWidth))
        ? '请填写尺码体系，文本每项不超过 32 个字符。'
        : '';
    case 'fit':
      return !validText(editor.fitPreference) ||
        editor.fitNotes.trim().length > 80
        ? '请填写版型（最多 32 个字符），补充说明最多 80 个字符。'
        : '';
    case 'budget': {
      const min = editor.budgetMin.trim()
        ? Number(editor.budgetMin)
        : undefined;
      const max = editor.budgetMax.trim()
        ? Number(editor.budgetMax)
        : undefined;
      return (min === undefined && max === undefined) ||
        [min, max].some(
          (value) =>
            value !== undefined && (!Number.isInteger(value) || value < 0),
        ) ||
        (min !== undefined && max !== undefined && min > max)
        ? '预算至少填写一项非负整数，且最低预算不能高于最高预算。'
        : '';
    }
    default: {
      const items = normalizePreferenceItems(
        editor.items,
        itemPresets[editor.category] ?? [],
      );
      if (!items.length) return '请至少选择或填写一项偏好。';
      if (items.length > itemLimit(editor.category))
        return `最多填写 ${itemLimit(editor.category)} 项偏好，请删除多余内容后保存。`;
      if (items.some((item) => !validText(item)))
        return '每项偏好最多 32 个字符，不能包含控制字符。';
      if (
        editor.category === 'avoidance' &&
        editor.avoidanceReason.trim().length > 80
      )
        return '原因最多 80 个字符。';
      return '';
    }
  }
}

export function editorFromMemory(memory: MemoryRecord): MemoryEditorState {
  const editor = createEmptyMemoryEditor();
  const value = memory.value as Record<string, unknown>;
  editor.category = memory.category;
  editor.isPrimary = memory.isPrimary;

  if (memory.category === 'size') {
    editor.garment = presetLabel(String(value.garment), garmentPresets);
    editor.label = String(value.label ?? '');
    editor.sizeSystem = presetLabel(String(value.system ?? ''), systemPresets);
  } else if (memory.category === 'shoe_size') {
    editor.shoeSize = String(value.value ?? '');
    editor.shoeSystem = presetLabel(String(value.system), systemPresets);
    editor.shoeWidth = presetLabel(String(value.width ?? ''), widthPresets);
  } else if (memory.category === 'fit') {
    editor.fitPreference = presetLabel(String(value.preference), fitPresets);
    editor.fitNotes = String(value.notes ?? '');
  } else if (memory.category === 'budget') {
    editor.currency = value.currency as MemoryEditorState['currency'];
    editor.budgetMin = value.min === undefined ? '' : String(value.min);
    editor.budgetMax = value.max === undefined ? '' : String(value.max);
  } else if (memory.category === 'color') {
    editor.colorMode = value.mode as MemoryEditorState['colorMode'];
    editor.items = Array.isArray(value.items)
      ? value.items
          .map((item) =>
            presetLabel(String(item), itemPresets[memory.category] ?? []),
          )
          .join('、')
      : '';
  } else if (memory.category === 'avoidance') {
    editor.items = Array.isArray(value.terms) ? value.terms.join('、') : '';
    editor.avoidanceReason = String(value.reason ?? '');
  } else {
    editor.items = Array.isArray(value.items)
      ? value.items
          .map((item) =>
            presetLabel(String(item), itemPresets[memory.category] ?? []),
          )
          .join('、')
      : '';
  }
  return editor;
}

export function useMemoriesPage() {
  const route = useRoute();
  // 使用地址参数区分菜单入口；非法值回退到原有偏好视图。
  const activeView = computed(() =>
    route.query.view === 'document' ? 'document' : 'preferences',
  );
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
      submitError.value =
        validateMemoryEditor(editor.value) || '请检查必填项和数值范围。';
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
        cause instanceof ApiError &&
        cause.status === 400 &&
        /Invalid|expected|value\./u.test(cause.message)
          ? '偏好内容不符合要求，请检查每项长度、数量和数值范围。'
          : cause instanceof Error
            ? cause.message
            : '保存偏好失败，请稍后重试。';
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
