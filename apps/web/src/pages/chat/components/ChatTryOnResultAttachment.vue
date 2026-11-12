<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { RefreshCw } from '@lucide/vue';
import { ApiError } from '@/api';
import { getTryOnResultDownload, getTryOnTask } from '@/api/modules/try-on';
import type { ChatTryOnResult } from '@/api/types/chat';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { auth } from '@/lib/auth';

const props = defineProps<{ result: ChatTryOnResult }>();
const status = ref<'loading' | 'success' | 'error' | 'unavailable'>('loading');
const imageUrl = ref('');
const imageErrorRetried = ref(false);
let controller: AbortController | null = null;
let requestVersion = 0;
let initialUserId = auth.state.user?.id ?? null;

watch(
  () => auth.state.user?.id,
  (userId) => {
    if (initialUserId === null && userId) {
      initialUserId = userId;
      void loadResult();
      return;
    }
    if (userId !== initialUserId) {
      requestVersion += 1;
      controller?.abort();
      imageUrl.value = '';
      status.value = 'unavailable';
      return;
    }
    if (userId && userId === initialUserId && status.value === 'unavailable')
      void loadResult();
  },
);

watch(
  () => props.result.taskId,
  () => {
    imageErrorRetried.value = false;
    void loadResult();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  requestVersion += 1;
  controller?.abort();
});

async function loadResult() {
  const token = auth.state.token;
  const userId = auth.state.user?.id;
  const taskId = props.result.taskId;
  if (!token || !userId || (initialUserId && userId !== initialUserId)) {
    imageUrl.value = '';
    status.value = 'unavailable';
    return;
  }
  initialUserId ??= userId;
  controller?.abort();
  const requestController = new AbortController();
  controller = requestController;
  const version = ++requestVersion;
  status.value = 'loading';
  imageUrl.value = '';

  const isCurrent = () =>
    !requestController.signal.aborted &&
    version === requestVersion &&
    userId === auth.state.user?.id &&
    taskId === props.result.taskId;

  try {
    // 先验证本人任务的成功状态，再获取短期地址；地址只保存在组件局部状态。
    const task = await getTryOnTask(token, taskId, requestController.signal);
    if (!isCurrent()) return;
    if (
      task.id !== taskId ||
      task.status !== 'succeeded' ||
      !task.result?.downloadable ||
      task.product.externalId !== props.result.product.externalId ||
      task.product.color !== props.result.product.color ||
      task.result.width !== props.result.result.width ||
      task.result.height !== props.result.result.height
    ) {
      status.value = 'unavailable';
      return;
    }
    const download = await getTryOnResultDownload(
      token,
      taskId,
      requestController.signal,
    );
    if (!isCurrent()) return;
    const rawUrl = download.url ?? download.downloadUrl;
    if (!rawUrl) throw new Error('结果地址不可用');
    const url = new URL(rawUrl);
    const localDevelopmentUrl =
      import.meta.env.DEV &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !localDevelopmentUrl) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      status.value = 'unavailable';
      return;
    }
    imageUrl.value = url.href;
    status.value = 'success';
  } catch (error) {
    if (!isCurrent()) return;
    status.value =
      error instanceof ApiError && [401, 403, 404, 410].includes(error.status)
        ? 'unavailable'
        : 'error';
  } finally {
    if (controller === requestController) controller = null;
  }
}

function handleImageError() {
  if (!imageErrorRetried.value) {
    imageErrorRetried.value = true;
    void loadResult();
    return;
  }
  imageUrl.value = '';
  status.value = 'error';
}
</script>

<template>
  <section
    class="grid min-w-0 gap-3 rounded-md border p-3"
    aria-label="试穿结果"
  >
    <header class="flex min-w-0 items-start gap-3">
      <div class="min-w-0 flex-1">
        <p class="break-words text-sm font-medium">
          {{ result.product.name }} · {{ result.product.color }}
        </p>
        <p class="text-xs text-muted-foreground">
          {{ result.result.width }} × {{ result.result.height }} ·
          生成结果仅供视觉参考
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="重新检查试穿结果"
        title="重新检查试穿结果"
        :disabled="status === 'loading'"
        @click="loadResult"
      >
        <RefreshCw />
      </Button>
    </header>
    <div
      v-if="status === 'loading'"
      class="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <Spinner aria-hidden="true" />
      正在加载试穿结果
    </div>
    <img
      v-else-if="status === 'success' && imageUrl"
      :src="imageUrl"
      :alt="`${result.product.name} ${result.product.color} 试穿结果`"
      class="max-h-[32rem] w-full rounded-sm bg-muted object-contain"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="handleImageError"
    />
    <Alert v-else-if="status === 'error'" variant="destructive">
      <AlertTitle>结果暂时无法加载</AlertTitle>
      <AlertDescription>
        请检查网络后重新获取本人任务的结果地址。
      </AlertDescription>
      <Button variant="outline" size="sm" @click="loadResult">
        <RefreshCw data-icon="inline-start" />
        重新加载
      </Button>
    </Alert>
    <Alert v-else variant="destructive">
      <AlertTitle>试穿结果不可用</AlertTitle>
      <AlertDescription>
        任务可能已删除，或当前账号无法访问该结果。
      </AlertDescription>
    </Alert>
  </section>
</template>
