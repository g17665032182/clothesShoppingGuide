import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
  type Ref,
  type UnwrapNestedRefs,
} from 'vue';

import { ApiError } from '@/api';
import {
  clearMemoryDocument,
  getMemoryDocument,
  getMemorySettings,
  updateMemoryDocument,
  updateMemorySettings,
} from '@/api/modules/memories';
import type { MemoryDocument } from '@/api/types/memories';
import { auth } from '@/lib/auth';

type DocumentStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export type MemoryDocumentState = UnwrapNestedRefs<
  ReturnType<typeof useMemoryDocument>
>;

export function useMemoryDocument(active: Readonly<Ref<boolean>>) {
  const document = ref<MemoryDocument | null>(null);
  const latest = ref<MemoryDocument | null>(null);
  const draft = ref('');
  const status = ref<DocumentStatus>('idle');
  const action = ref<'idle' | 'saving' | 'clearing'>('idle');
  const error = ref('');
  const conflict = ref(false);
  const saved = ref(false);
  const preview = ref(false);
  const clearOpen = ref(false);
  const enabled = ref<boolean | null>(null);
  const settingsStatus = ref<DocumentStatus>('idle');
  const settingPending = ref(false);
  const settingError = ref('');
  const dirty = computed(
    () => document.value !== null && draft.value !== document.value.content,
  );
  const bytes = computed(() => new TextEncoder().encode(draft.value).length);
  const busy = computed(() => action.value !== 'idle');
  let loadController: AbortController | null = null;
  let actionController: AbortController | null = null;
  let settingsController: AbortController | null = null;
  let loadVersion = 0;
  let lifecycleVersion = 0;
  let activeNow = false;
  let mounted = false;
  let suspended = false;
  let unmounted = false;

  function isCurrent(controller: AbortController, version: number) {
    return (
      !unmounted &&
      activeNow &&
      lifecycleVersion === version &&
      !controller.signal.aborted
    );
  }

  async function loadDocument(compare = false) {
    const token = auth.state.token;
    if (!token || busy.value || !activeNow) return;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const requestVersion = ++loadVersion;
    const version = lifecycleVersion;
    const preserveDraft = dirty.value || conflict.value;
    if (!compare) status.value = 'loading';
    if (!conflict.value) error.value = '';
    try {
      const result = await getMemoryDocument(token, controller.signal);
      if (!isCurrent(controller, version) || requestVersion !== loadVersion)
        return;
      if (compare) {
        latest.value = result;
      } else if (preserveDraft) {
        // 重新激活只检查版本，绝不以远端正文覆盖未保存的本地草稿。
        if (result.revision !== document.value?.revision) {
          latest.value = result;
          conflict.value = true;
          error.value = '文档已在其他地方更新。请比对最新版本后决定如何合并。';
        }
        status.value = draft.value ? 'success' : 'empty';
      } else {
        document.value = result;
        draft.value = result.content;
        status.value = result.content ? 'success' : 'empty';
      }
    } catch (cause) {
      if (!isCurrent(controller, version) || requestVersion !== loadVersion)
        return;
      if (!compare) status.value = 'error';
      error.value =
        cause instanceof Error ? cause.message : '读取记忆文档失败。';
    } finally {
      if (loadController === controller) loadController = null;
    }
  }

  async function save() {
    const token = auth.state.token;
    if (
      !token ||
      !document.value ||
      busy.value ||
      conflict.value ||
      !dirty.value ||
      !activeNow ||
      status.value === 'loading'
    )
      return;
    if (draft.value === '') {
      clearOpen.value = true;
      return;
    }
    if (bytes.value > 32768) {
      error.value = '文档不能超过 32 KiB。';
      return;
    }
    loadController?.abort();
    loadVersion += 1;
    const controller = new AbortController();
    actionController = controller;
    const version = lifecycleVersion;
    const content = draft.value;
    action.value = 'saving';
    error.value = '';
    saved.value = false;
    try {
      const result = await updateMemoryDocument(
        token,
        content,
        document.value.revision,
        controller.signal,
      );
      if (!isCurrent(controller, version)) return;
      document.value = result;
      saved.value = draft.value === content;
      status.value = result.content ? 'success' : 'empty';
    } catch (cause) {
      if (!isCurrent(controller, version)) return;
      if (cause instanceof ApiError && cause.status === 409) {
        conflict.value = true;
        latest.value = null;
        error.value = '文档已在其他地方更新。请比对最新版本后决定如何合并。';
      } else {
        error.value =
          cause instanceof Error ? cause.message : '保存记忆文档失败。';
      }
    } finally {
      if (actionController === controller) {
        actionController = null;
        action.value = 'idle';
      }
    }
    if (isCurrent(controller, version) && conflict.value)
      await loadDocument(true);
  }

  function updateDraft(content: string) {
    draft.value = content;
    saved.value = false;
  }

  function useLatestAsBase() {
    if (!latest.value) return;
    // 仅变更下次提交所用 revision，保留用户自行合并的草稿。
    document.value = latest.value;
    latest.value = null;
    conflict.value = false;
    error.value = '';
    saved.value = false;
  }

  async function clearDocument() {
    const token = auth.state.token;
    if (!token || busy.value || !activeNow) return;
    loadController?.abort();
    loadVersion += 1;
    const controller = new AbortController();
    actionController = controller;
    const version = lifecycleVersion;
    action.value = 'clearing';
    error.value = '';
    let cleared = false;
    try {
      await clearMemoryDocument(token, controller.signal);
      if (!isCurrent(controller, version)) return;
      clearOpen.value = false;
      conflict.value = false;
      latest.value = null;
      saved.value = false;
      document.value = null;
      draft.value = '';
      status.value = 'idle';
      cleared = true;
    } catch (cause) {
      if (!isCurrent(controller, version)) return;
      error.value =
        cause instanceof Error ? cause.message : '清空记忆文档失败。';
    } finally {
      if (actionController === controller) {
        actionController = null;
        action.value = 'idle';
      }
    }
    // DELETE 不返回 revision，成功后重新读取，禁止以清空前的版本提交。
    if (cleared && isCurrent(controller, version)) await loadDocument();
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
      const settings = await getMemorySettings(token, controller.signal);
      if (!isCurrent(controller, version)) return;
      enabled.value = settings.enabled;
      settingsStatus.value = 'success';
    } catch (cause) {
      if (!isCurrent(controller, version)) return;
      settingsStatus.value = 'error';
      settingError.value =
        cause instanceof Error ? cause.message : '读取记忆设置失败。';
    } finally {
      if (settingsController === controller) settingsController = null;
    }
  }

  async function toggleEnabled(nextEnabled: boolean) {
    const token = auth.state.token;
    if (
      !token ||
      !activeNow ||
      settingPending.value ||
      settingsStatus.value !== 'success' ||
      nextEnabled === enabled.value
    )
      return;
    settingsController?.abort();
    const controller = new AbortController();
    settingsController = controller;
    const version = lifecycleVersion;
    settingPending.value = true;
    settingError.value = '';
    try {
      const settings = await updateMemorySettings(
        token,
        nextEnabled,
        controller.signal,
      );
      if (!isCurrent(controller, version)) return;
      enabled.value = settings.enabled;
    } catch (cause) {
      if (!isCurrent(controller, version)) return;
      settingError.value =
        cause instanceof Error ? cause.message : '更新记忆设置失败。';
    } finally {
      if (settingsController === controller) {
        settingsController = null;
        settingPending.value = false;
      }
    }
  }

  function activate() {
    if (!mounted || suspended || unmounted || !active.value || activeNow)
      return;
    activeNow = true;
    void loadDocument();
    void loadSettings();
  }

  function pause() {
    activeNow = false;
    lifecycleVersion += 1;
    loadVersion += 1;
    loadController?.abort();
    actionController?.abort();
    settingsController?.abort();
    loadController = null;
    actionController = null;
    settingsController = null;
    action.value = 'idle';
    settingPending.value = false;
    if (status.value === 'loading') status.value = 'idle';
    if (settingsStatus.value === 'loading') settingsStatus.value = 'idle';
  }

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
    document,
    latest,
    draft,
    status,
    action,
    error,
    conflict,
    saved,
    preview,
    clearOpen,
    dirty,
    bytes,
    busy,
    enabled,
    settingsStatus,
    settingPending,
    settingError,
    loadDocument,
    save,
    updateDraft,
    useLatestAsBase,
    clearDocument,
    loadSettings,
    toggleEnabled,
  };
}
