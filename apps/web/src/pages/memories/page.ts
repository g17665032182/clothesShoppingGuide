import { computed, reactive } from 'vue';
import { useRoute } from 'vue-router';

import { useMemoryDocument } from './use-memory-document';
import { usePreferences } from './use-preferences';

export function useMemoriesPage() {
  const route = useRoute();
  // 地址只决定当前视图，两份业务状态各自持有请求和设置。
  const activeView = computed(() =>
    route.query.view === 'document' ? 'document' : 'preferences',
  );
  const preferences = usePreferences(
    computed(() => activeView.value === 'preferences'),
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
