import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
  type Ref,
} from 'vue';
import { toast } from 'vue-sonner';
import { useErrorToast } from '@/composables/use-error-toast';
import {
  categoryLabel,
  formatPreferenceValue,
  preferenceCategories,
} from './preference-display';
export {
  formatPreferenceValue,
  preferenceCategories,
} from './preference-display';

import {
  createPreference,
  deleteAllPreferences,
  deletePreference,
  getPreferenceSettings,
  listPreferences,
  updatePreference,
  updatePreferenceSettings,
} from '@/api/modules/preferences';
import type {
  CreatePreferencePayload,
  PreferenceCategory,
  PreferenceRecord,
  PreferenceValue,
  UpdatePreferencePayload,
} from '@/api/types/preferences';
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

export type PreferencePageStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'empty'
  | 'error';

export type PreferenceEditorState = {
  category: PreferenceCategory;
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

export function createEmptyPreferenceEditor(): PreferenceEditorState {
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

export function editorToValue(
  editor: PreferenceEditorState,
): PreferenceValue | null {
  if (validatePreferenceEditor(editor)) return null;
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

export function validatePreferenceEditor(
  editor: PreferenceEditorState,
): string {
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

export function editorFromPreference(
  preference: PreferenceRecord,
): PreferenceEditorState {
  const editor = createEmptyPreferenceEditor();
  const value = preference.value as Record<string, unknown>;
  editor.category = preference.category;
  editor.isPrimary = preference.isPrimary;

  if (preference.category === 'size') {
    editor.garment = presetLabel(String(value.garment), garmentPresets);
    editor.label = String(value.label ?? '');
    editor.sizeSystem = presetLabel(String(value.system ?? ''), systemPresets);
  } else if (preference.category === 'shoe_size') {
    editor.shoeSize = String(value.value ?? '');
    editor.shoeSystem = presetLabel(String(value.system), systemPresets);
    editor.shoeWidth = presetLabel(String(value.width ?? ''), widthPresets);
  } else if (preference.category === 'fit') {
    editor.fitPreference = presetLabel(String(value.preference), fitPresets);
    editor.fitNotes = String(value.notes ?? '');
  } else if (preference.category === 'budget') {
    editor.currency = value.currency as PreferenceEditorState['currency'];
    editor.budgetMin = value.min === undefined ? '' : String(value.min);
    editor.budgetMax = value.max === undefined ? '' : String(value.max);
  } else if (preference.category === 'color') {
    editor.colorMode = value.mode as PreferenceEditorState['colorMode'];
    editor.items = Array.isArray(value.items)
      ? value.items
          .map((item) =>
            presetLabel(String(item), itemPresets[preference.category] ?? []),
          )
          .join('、')
      : '';
  } else if (preference.category === 'avoidance') {
    editor.items = Array.isArray(value.terms) ? value.terms.join('、') : '';
    editor.avoidanceReason = String(value.reason ?? '');
  } else {
    editor.items = Array.isArray(value.items)
      ? value.items
          .map((item) =>
            presetLabel(String(item), itemPresets[preference.category] ?? []),
          )
          .join('、')
      : '';
  }
  return editor;
}

export function usePreferences(
  active: Readonly<Ref<boolean>>,
  selectedCategory: Readonly<Ref<PreferenceCategory | ''>>,
  updateCategoryQuery: (category: PreferenceCategory | '') => void,
) {
  const records = ref<PreferenceRecord[]>([]);
  const status = ref<PreferencePageStatus>('idle');
  const error = ref('');
  const submitError = ref('');
  const validationError = ref('');
  const page = ref(1);
  const total = ref(0);
  const totalPages = ref(0);
  const enabled = ref<boolean | null>(null);
  const settingsStatus = ref<PreferencePageStatus>('idle');
  const settingError = ref('');
  useErrorToast(() => (active.value ? error.value : ''));
  useErrorToast(() => (active.value ? submitError.value : ''));
  useErrorToast(() => (active.value ? settingError.value : ''));
  const settingPending = ref(false);
  const editorOpen = ref(false);
  const editingId = ref<string | null>(null);
  const editor = ref<PreferenceEditorState>(createEmptyPreferenceEditor());
  const submitting = ref(false);
  const deletingId = ref<string | null>(null);
  const deletingAll = ref(false);
  const deleteAllDialogOpen = ref(false);
  let loadController: AbortController | null = null;
  let loadVersion = 0;
  let unmounted = false;
  let mounted = false;
  let suspended = false;
  let activeNow = false;
  let lifecycleVersion = 0;
  let actionController: AbortController | null = null;
  let settingsController: AbortController | null = null;

  function isCurrent(controller: AbortController, version: number) {
    return (
      !unmounted &&
      activeNow &&
      version === lifecycleVersion &&
      !controller.signal.aborted
    );
  }

  const busy = computed(
    () =>
      submitting.value ||
      deletingId.value !== null ||
      deletingAll.value ||
      settingPending.value,
  );
  const canGoBack = computed(
    () => page.value > 1 && status.value !== 'loading' && !busy.value,
  );
  const canGoForward = computed(
    () =>
      page.value < totalPages.value &&
      status.value !== 'loading' &&
      !busy.value,
  );
  const editingTitle = computed(() =>
    editingId.value ? '编辑偏好' : '添加偏好',
  );

  async function loadPreferences(targetPage = page.value) {
    const token = auth.state.token;
    if (!token || unmounted || !activeNow) return;

    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const version = ++loadVersion;
    status.value = 'loading';
    error.value = '';
    try {
      const response = await listPreferences(token, {
        page: targetPage,
        pageSize,
        ...(selectedCategory.value ? { category: selectedCategory.value } : {}),
        signal: controller.signal,
      });
      if (unmounted || version !== loadVersion) return;
      records.value = response.items;
      // 开关只由独立设置请求更新，分页旧响应不能覆盖刚保存的设置。
      page.value = response.page;
      total.value = response.total;
      totalPages.value = response.totalPages;
      status.value = response.items.length > 0 ? 'success' : 'empty';
    } catch (cause) {
      if (controller.signal.aborted || unmounted || version !== loadVersion)
        return;
      status.value = 'error';
      error.value =
        cause instanceof Error ? cause.message : '偏好列表加载失败。';
    } finally {
      if (version === loadVersion) loadController = null;
    }
  }

  function startCreate() {
    editingId.value = null;
    editor.value = createEmptyPreferenceEditor();
    submitError.value = '';
    validationError.value = '';
    editorOpen.value = true;
  }

  function startEdit(preference: PreferenceRecord) {
    editingId.value = preference.id;
    editor.value = editorFromPreference(preference);
    submitError.value = '';
    validationError.value = '';
    editorOpen.value = true;
  }

  function cancelEdit() {
    if (submitting.value) return;
    editorOpen.value = false;
    editingId.value = null;
    submitError.value = '';
    validationError.value = '';
  }

  async function savePreference() {
    const token = auth.state.token;
    if (!token || busy.value || !activeNow) return;
    const value = editorToValue(editor.value);
    if (!value) {
      validationError.value =
        validatePreferenceEditor(editor.value) || '请检查必填项和数值范围。';
      return;
    }

    submitting.value = true;
    validationError.value = '';
    submitError.value = '';
    const controller = new AbortController();
    actionController = controller;
    const version = lifecycleVersion;
    try {
      if (editingId.value) {
        const payload: UpdatePreferencePayload = {
          category: editor.value.category,
          value,
          isPrimary: editor.value.isPrimary,
        };
        await updatePreference(
          token,
          editingId.value,
          payload,
          controller.signal,
        );
      } else {
        const payload: CreatePreferencePayload = {
          category: editor.value.category,
          value,
          isPrimary: editor.value.isPrimary,
        };
        await createPreference(token, payload, controller.signal);
      }
      if (!isCurrent(controller, version)) return;
      editorOpen.value = false;
      toast.success('偏好已保存');
      editingId.value = null;
      await loadPreferences(1);
    } catch (cause) {
      if (!isCurrent(controller, version)) return;
      submitError.value =
        cause instanceof ApiError &&
        cause.status === 400 &&
        /Invalid|expected|value\./u.test(cause.message)
          ? '偏好内容不符合要求，请检查每项长度、数量和数值范围。'
          : cause instanceof Error
            ? cause.message
            : '保存偏好失败，请稍后重试。';
    } finally {
      if (actionController === controller) {
        submitting.value = false;
        actionController = null;
      }
    }
  }

  async function removePreference(preferenceId: string) {
    const token = auth.state.token;
    if (!token || busy.value || !activeNow) return;
    deletingId.value = preferenceId;
    submitError.value = '';
    const controller = new AbortController();
    actionController = controller;
    const version = lifecycleVersion;
    try {
      await deletePreference(token, preferenceId, controller.signal);
      if (!isCurrent(controller, version)) return;
      toast.success('偏好已删除');
      if (records.value.length === 1 && page.value > 1) {
        await loadPreferences(page.value - 1);
      } else {
        await loadPreferences(page.value);
      }
    } catch (cause) {
      if (!isCurrent(controller, version)) return;
      submitError.value =
        cause instanceof Error ? cause.message : '删除偏好失败。';
    } finally {
      if (actionController === controller) {
        deletingId.value = null;
        actionController = null;
      }
    }
  }

  async function removeAllPreferences() {
    const token = auth.state.token;
    if (!token || busy.value || total.value === 0 || !activeNow) return;
    deletingAll.value = true;
    submitError.value = '';
    const controller = new AbortController();
    actionController = controller;
    const version = lifecycleVersion;
    try {
      await deleteAllPreferences(token, controller.signal);
      if (!isCurrent(controller, version)) return;
      toast.success('全部偏好已删除');
      deleteAllDialogOpen.value = false;
      page.value = 1;
      await loadPreferences(1);
    } catch (cause) {
      if (!isCurrent(controller, version)) return;
      submitError.value =
        cause instanceof Error ? cause.message : '删除全部偏好失败。';
    } finally {
      if (actionController === controller) {
        deletingAll.value = false;
        actionController = null;
      }
    }
  }

  async function toggleEnabled(nextEnabled: boolean) {
    const token = auth.state.token;
    if (
      !token ||
      settingPending.value ||
      nextEnabled === enabled.value ||
      settingsStatus.value !== 'success' ||
      !activeNow
    )
      return;
    settingsController?.abort();
    const controller = new AbortController();
    settingsController = controller;
    const version = lifecycleVersion;
    settingPending.value = true;
    settingError.value = '';
    try {
      const settings = await updatePreferenceSettings(
        token,
        nextEnabled,
        controller.signal,
      );
      if (!isCurrent(controller, version)) return;
      enabled.value = settings.enabled;
      toast.success(settings.enabled ? '已开启参考偏好' : '已关闭参考偏好');
    } catch (cause) {
      if (!isCurrent(controller, version)) return;
      settingError.value =
        cause instanceof Error ? cause.message : '更新偏好设置失败。';
    } finally {
      if (settingsController === controller) {
        settingPending.value = false;
        settingsController = null;
      }
    }
  }

  async function loadSettings() {
    const token = auth.state.token;
    if (!token || !activeNow || settingPending.value) return;
    settingsController?.abort();
    const controller = new AbortController();
    settingsController = controller;
    const version = lifecycleVersion;
    settingsStatus.value = 'loading';
    settingError.value = '';
    try {
      const settings = await getPreferenceSettings(token, controller.signal);
      if (!isCurrent(controller, version)) return;
      enabled.value = settings.enabled;
      settingsStatus.value = 'success';
    } catch (cause) {
      if (!isCurrent(controller, version)) return;
      settingsStatus.value = 'error';
      settingError.value =
        cause instanceof Error ? cause.message : '读取偏好设置失败。';
    } finally {
      if (settingsController === controller) settingsController = null;
    }
  }

  function changeCategory(category: PreferenceCategory | '') {
    updateCategoryQuery(category);
  }

  function changePage(nextPage: number) {
    if (
      nextPage < 1 ||
      nextPage > totalPages.value ||
      status.value === 'loading' ||
      busy.value
    )
      return;
    void loadPreferences(nextPage);
  }

  function activate() {
    if (!mounted || suspended || unmounted || !active.value || activeNow)
      return;
    activeNow = true;
    void loadPreferences();
    void loadSettings();
  }

  function pause() {
    activeNow = false;
    lifecycleVersion += 1;
    loadVersion += 1;
    loadController?.abort();
    loadController = null;
    actionController?.abort();
    actionController = null;
    settingsController?.abort();
    settingsController = null;
    submitting.value = false;
    deletingId.value = null;
    deletingAll.value = false;
    settingPending.value = false;
    if (status.value === 'loading') status.value = 'idle';
    if (settingsStatus.value === 'loading') settingsStatus.value = 'idle';
  }

  watch(
    selectedCategory,
    (category, previousCategory) => {
      page.value = 1;
      if (category !== previousCategory && active.value && activeNow)
        void loadPreferences(1);
    },
    { immediate: true, flush: 'sync' },
  );
  watch(active, (value) => (value ? activate() : pause()));
  onMounted(() => {
    mounted = true;
    activate();
  });
  onActivated(() => {
    suspended = false;
    activate();
  });
  onDeactivated(() => {
    suspended = true;
    pause();
  });
  onBeforeUnmount(() => {
    unmounted = true;
    pause();
  });

  return {
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
    formatPreferenceValue,
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
    submitError,
    validationError,
    submitting,
    cancelEdit,
    toggleEnabled,
    total,
    totalPages,
    settingPending,
    settingsStatus,
    settingError,
    loadSettings,
  };
}
