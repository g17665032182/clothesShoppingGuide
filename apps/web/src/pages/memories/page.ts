import { computed, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useMemoryDocument } from './use-memory-document';
import { preferenceCategories, usePreferences } from './use-preferences';
import type { PreferenceCategory } from '@/api/types/preferences';

function isPreferenceCategory(value: unknown): value is PreferenceCategory {
  return (
    typeof value === 'string' &&
    preferenceCategories.some((item) => item.value === value)
  );
}

export function useMemoriesPage() {
  const route = useRoute();
  const router = useRouter();
  // 地址只决定当前视图，两份业务状态各自持有请求和设置。
  const activeView = computed(() =>
    route.query.view === 'document' ? 'document' : 'preferences',
  );
  const selectedCategory = computed<PreferenceCategory | ''>(() => {
    const category = route.query.category;
    return activeView.value === 'preferences' && isPreferenceCategory(category)
      ? category
      : '';
  });
  // URL 是筛选状态的唯一来源；数组、非法值和文档视图中的类别都清除。
  watch(
    () => [activeView.value, route.query.category] as const,
    ([view, category]) => {
      if (
        category !== undefined &&
        (view === 'document' || !isPreferenceCategory(category))
      ) {
        void router.replace({
          query: { ...route.query, category: undefined },
        });
      }
    },
    { immediate: true, flush: 'sync' },
  );
  function updateCategoryQuery(category: PreferenceCategory | '') {
    void router.replace({
      name: 'account-memories',
      query: {
        ...route.query,
        view: 'preferences',
        category: category || undefined,
      },
    });
  }
  const preferences = usePreferences(
    computed(() => activeView.value === 'preferences'),
    selectedCategory,
    updateCategoryQuery,
  );
  const memoryDocument = reactive(
    useMemoryDocument(computed(() => activeView.value === 'document')),
  );
  const documentActive = computed(() => activeView.value === 'document');
  const enabled = computed(() =>
    documentActive.value ? memoryDocument.enabled : preferences.enabled.value,
  );
  const settingPending = computed(() =>
    documentActive.value
      ? memoryDocument.settingPending
      : preferences.settingPending.value,
  );
  const settingsStatus = computed(() =>
    documentActive.value
      ? memoryDocument.settingsStatus
      : preferences.settingsStatus.value,
  );
  const settingError = computed(() =>
    documentActive.value
      ? memoryDocument.settingError
      : preferences.settingError.value,
  );

  function toggleEnabled(nextEnabled: boolean) {
    return documentActive.value
      ? memoryDocument.toggleEnabled(nextEnabled)
      : preferences.toggleEnabled(nextEnabled);
  }

  function loadSettings() {
    return documentActive.value
      ? memoryDocument.loadSettings()
      : preferences.loadSettings();
  }

  return {
    ...preferences,
    activeView,
    memoryDocument,
    enabled,
    settingPending,
    settingsStatus,
    settingError,
    toggleEnabled,
    loadSettings,
  };
}
