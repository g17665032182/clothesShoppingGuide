import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { toast } from 'vue-sonner';
import { useErrorToast } from '@/composables/use-error-toast';
import { ApiError } from '@/api';
import {
  createTryOnTask,
  deleteTryOnPhoto,
  deleteTryOnTask,
  getTryOnResultDownload,
  listSavedTryOnPhotos,
  listTryOnTasks,
  markTryOnNotificationRead,
  uploadTryOnPhoto,
} from '@/api/modules/try-on';
import type { TryOnPhoto, TryOnTask } from '@/api/types/try-on';
import { auth } from '@/lib/auth';

type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

const CONSENT_VERSION = 'v1';

export function useMyTryOnsPage() {
  const route = useRoute();
  const tasks = ref<TryOnTask[]>([]);
  const resultImageUrls = ref<Record<string, string>>({});
  const resultImageExpiresAt = ref<Record<string, number>>({});
  const savedPhotos = ref<TryOnPhoto[]>([]);
  const listStatus = ref<AsyncStatus>('idle');
  const listError = ref('');
  const photoStatus = ref<AsyncStatus>('idle');
  const photoError = ref('');
  const actionError = ref('');
  useErrorToast(() => listError.value);
  useErrorToast(() => photoError.value);
  useErrorToast(() => actionError.value);
  const selectedPhotoId = ref<string | null>(null);
  const selectedColor = ref('');
  const consentOpen = ref(false);
  const submitting = ref(false);
  const actionTaskId = ref<string | null>(null);
  const deletingPhotoId = ref<string | null>(null);
  let listController: AbortController | null = null;
  let photoController: AbortController | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  const actionController = new AbortController();

  function captureIdentity() {
    const userId = auth.state.user?.id;
    return () => !disposed && userId === auth.state.user?.id;
  }

  const product = computed(() => {
    const externalId = String(route.query.productExternalId ?? '').trim();
    if (!externalId) return null;
    const colors = String(route.query.colors ?? '')
      .split(',')
      .map((color) => color.trim())
      .filter(Boolean);
    return {
      externalId,
      name: String(route.query.productName ?? '当前商品'),
      category: String(route.query.category ?? ''),
      imageUrl: String(route.query.imageUrl ?? '') || null,
      colors,
    };
  });

  const activeTask = computed(() =>
    tasks.value.find((task) => ['queued', 'processing'].includes(task.status)),
  );

  const canSubmit = computed(
    () =>
      Boolean(product.value) &&
      Boolean(selectedColor.value) &&
      Boolean(selectedPhotoId.value) &&
      !activeTask.value &&
      !submitting.value,
  );

  function syncProductFromQuery() {
    selectedColor.value = product.value?.colors[0] ?? selectedColor.value ?? '';
  }

  function isAbort(error: unknown) {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  async function loadTasks() {
    const token = auth.state.token;
    if (!token || disposed) return;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    listStatus.value = 'loading';
    listError.value = '';
    try {
      const result = await listTryOnTasks(
        token,
        { page: 1, pageSize: 20 },
        controller.signal,
      );
      if (controller.signal.aborted || disposed) return;
      tasks.value = result.items;
      listStatus.value = result.items.length ? 'success' : 'empty';
      void loadResultImageUrls(result.items, token, controller.signal);
      if (
        !tasks.value.some((task) =>
          ['queued', 'processing'].includes(task.status),
        )
      ) {
        stopPolling();
      }
    } catch (error) {
      if (!controller.signal.aborted && !disposed && !isAbort(error)) {
        listStatus.value = 'error';
        listError.value =
          error instanceof Error ? error.message : '试穿历史加载失败';
      }
    }
  }

  async function loadResultImageUrls(
    currentTasks: TryOnTask[],
    token: string,
    signal: AbortSignal,
  ) {
    const succeeded = currentTasks.filter(
      (task) => task.status === 'succeeded' && task.result?.downloadable,
    );
    const activeIds = new Set(succeeded.map((task) => task.id));
    resultImageUrls.value = Object.fromEntries(
      Object.entries(resultImageUrls.value).filter(([taskId]) =>
        activeIds.has(taskId),
      ),
    );
    resultImageExpiresAt.value = Object.fromEntries(
      Object.entries(resultImageExpiresAt.value).filter(([taskId]) =>
        activeIds.has(taskId),
      ),
    );
    await Promise.all(
      succeeded.map(async (task) => {
        if (
          resultImageUrls.value[task.id] &&
          (resultImageExpiresAt.value[task.id] ?? 0) > Date.now() + 10_000
        )
          return;
        try {
          const response = await getTryOnResultDownload(token, task.id, signal);
          if (signal.aborted || disposed) return;
          const rawUrl = response.url ?? response.downloadUrl;
          if (!rawUrl) return;
          const url = new URL(rawUrl);
          if (url.protocol !== 'https:') return;
          resultImageUrls.value[task.id] = url.href;
          resultImageExpiresAt.value[task.id] =
            Date.now() + Math.max(30, response.expiresInSeconds ?? 240) * 1000;
        } catch {
          // 短时授权地址失败时保留任务状态和下载入口。
        }
      }),
    );
  }

  async function loadSavedPhotos() {
    const token = auth.state.token;
    if (!token || disposed) return;
    photoController?.abort();
    const controller = new AbortController();
    photoController = controller;
    photoStatus.value = 'loading';
    photoError.value = '';
    try {
      const result = await listSavedTryOnPhotos(token, controller.signal);
      if (controller.signal.aborted || disposed) return;
      savedPhotos.value = result.items;
      photoStatus.value = result.items.length ? 'success' : 'empty';
    } catch (error) {
      if (!controller.signal.aborted && !disposed && !isAbort(error)) {
        photoStatus.value = 'error';
        photoError.value =
          error instanceof Error ? error.message : '照片列表加载失败';
      }
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => void loadTasks(), 4000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function uploadPhoto(file: File, save: boolean) {
    const token = auth.state.token;
    if (!token || submitting.value) return;
    const isCurrent = captureIdentity();
    actionError.value = '';
    submitting.value = true;
    try {
      const result = await uploadTryOnPhoto(
        token,
        file,
        save,
        actionController.signal,
      );
      if (!isCurrent()) return;
      selectedPhotoId.value = result.id;
      toast.success('照片已上传');
      if (save) await loadSavedPhotos();
    } catch (error) {
      if (!isCurrent()) return;
      actionError.value =
        error instanceof Error ? error.message : '照片上传失败';
    } finally {
      submitting.value = false;
    }
  }

  async function submitTask() {
    if (!canSubmit.value) return;
    consentOpen.value = true;
  }

  async function confirmConsent() {
    const token = auth.state.token;
    const currentProduct = product.value;
    if (
      !token ||
      !currentProduct ||
      !selectedPhotoId.value ||
      !selectedColor.value ||
      submitting.value
    )
      return;
    const isCurrent = captureIdentity();
    submitting.value = true;
    actionError.value = '';
    try {
      const task = await createTryOnTask(
        token,
        {
          productExternalId: currentProduct.externalId,
          color: selectedColor.value,
          photoId: selectedPhotoId.value,
          consentVersion: CONSENT_VERSION,
        },
        actionController.signal,
      );
      if (!isCurrent()) return;
      tasks.value = [
        task,
        ...tasks.value.filter((item) => item.id !== task.id),
      ];
      listStatus.value = 'success';
      consentOpen.value = false;
      toast.success('试穿任务已提交');
      startPolling();
    } catch (error) {
      if (!isCurrent()) return;
      actionError.value =
        error instanceof ApiError && error.status === 409
          ? error.message
          : error instanceof Error
            ? error.message
            : '试穿任务创建失败';
    } finally {
      submitting.value = false;
    }
  }

  async function downloadTask(task: TryOnTask) {
    const token = auth.state.token;
    if (!token || task.status !== 'succeeded' || actionTaskId.value) return;
    const isCurrent = captureIdentity();
    actionTaskId.value = task.id;
    actionError.value = '';
    try {
      const result = await getTryOnResultDownload(
        token,
        task.id,
        actionController.signal,
      );
      if (!isCurrent()) return;
      const url = result.url ?? result.downloadUrl;
      if (!url) throw new Error('服务器未返回下载地址');
      const link = document.createElement('a');
      link.href = url;
      link.download = `${task.product.name}-试穿.png`;
      link.rel = 'noopener';
      link.click();
      toast.success('已发起试穿结果下载');
    } catch (error) {
      if (!isCurrent()) return;
      actionError.value =
        error instanceof Error ? error.message : '结果下载失败';
    } finally {
      actionTaskId.value = null;
    }
  }

  async function deleteTask(task: TryOnTask) {
    const token = auth.state.token;
    if (
      !token ||
      actionTaskId.value ||
      task.status !== 'succeeded' ||
      !window.confirm('删除这条试穿结果？')
    )
      return;
    const isCurrent = captureIdentity();
    actionTaskId.value = task.id;
    actionError.value = '';
    try {
      await deleteTryOnTask(token, task.id, actionController.signal);
      if (!isCurrent()) return;
      tasks.value = tasks.value.filter((item) => item.id !== task.id);
      delete resultImageUrls.value[task.id];
      delete resultImageExpiresAt.value[task.id];
      toast.success('试穿结果已删除');
      listStatus.value = tasks.value.length ? 'success' : 'empty';
    } catch (error) {
      if (!isCurrent()) return;
      actionError.value =
        error instanceof Error ? error.message : '结果删除失败';
    } finally {
      actionTaskId.value = null;
    }
  }

  async function deletePhoto(id: string) {
    const token = auth.state.token;
    if (
      !token ||
      deletingPhotoId.value ||
      !window.confirm('删除这张保存的照片？')
    )
      return;
    const isCurrent = captureIdentity();
    photoError.value = '';
    deletingPhotoId.value = id;
    try {
      await deleteTryOnPhoto(token, id, actionController.signal);
      if (!isCurrent()) return;
      savedPhotos.value = savedPhotos.value.filter((photo) => photo.id !== id);
      if (selectedPhotoId.value === id) selectedPhotoId.value = null;
      toast.success('照片已删除');
    } catch (error) {
      if (!isCurrent()) return;
      photoError.value =
        error instanceof Error ? error.message : '照片删除失败';
    } finally {
      deletingPhotoId.value = null;
    }
  }

  async function markRead(task: TryOnTask) {
    const token = auth.state.token;
    if (!token || !task.notification.unread) return;
    const isCurrent = captureIdentity();
    actionError.value = '';
    try {
      await markTryOnNotificationRead(token, task.id, actionController.signal);
      if (!isCurrent()) return;
      task.notification.unread = false;
    } catch (error) {
      if (!isCurrent()) return;
      actionError.value =
        error instanceof Error ? error.message : '提醒状态更新失败';
    }
  }

  watch(
    () => route.query.productExternalId,
    () => syncProductFromQuery(),
    { immediate: true },
  );

  onMounted(async () => {
    await auth.hydrate();
    if (!auth.state.token) return;
    await Promise.all([loadTasks(), loadSavedPhotos()]);
    if (activeTask.value) startPolling();
  });

  onBeforeUnmount(() => {
    disposed = true;
    actionController.abort();
    listController?.abort();
    photoController?.abort();
    stopPolling();
  });

  return {
    product,
    tasks,
    resultImageUrls,
    savedPhotos,
    listStatus,
    listError,
    photoStatus,
    photoError,
    actionError,
    selectedPhotoId,
    selectedColor,
    consentOpen,
    submitting,
    actionTaskId,
    deletingPhotoId,
    activeTask,
    canSubmit,
    loadTasks,
    loadSavedPhotos,
    uploadPhoto,
    submitTask,
    confirmConsent,
    downloadTask,
    deleteTask,
    deletePhoto,
    markRead,
  };
}
