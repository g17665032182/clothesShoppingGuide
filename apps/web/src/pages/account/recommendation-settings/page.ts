import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { toast } from 'vue-sonner';
import { ApiError } from '@/api';
import {
  clearRecommendationProfile,
  getRecommendationProfile,
  updateRecommendationSettings,
} from '@/api/modules/fashion-recommendation';
import type { RecommendationProfile } from '@/api/types/fashion-recommendation';
import { auth } from '@/lib/auth';

type PageStatus = 'idle' | 'loading' | 'success' | 'error';
type MutationStatus = 'idle' | 'submitting' | 'unknown' | 'error';

function emptyProfile(): RecommendationProfile {
  return {
    preferredStyles: [],
    avoidedStyles: [],
    preferredOccasions: [],
    priceSensitivity: null,
    silhouetteSignals: [],
    evidenceCount: 0,
    version: 1,
    updatedAt: null,
    learningEnabled: true,
  };
}

export function useRecommendationSettingsPage() {
  const profile = ref<RecommendationProfile>(emptyProfile());
  const pageStatus = ref<PageStatus>('idle');
  const mutationStatus = ref<MutationStatus>('idle');
  const errorMessage = ref('');
  const mutationError = ref('');
  let controller: AbortController | null = null;
  let disposed = false;

  const isLoading = computed(() => pageStatus.value === 'loading');
  const isMutating = computed(() => mutationStatus.value === 'submitting');

  async function load(): Promise<void> {
    const token = auth.state.token;
    if (!token) return;
    controller?.abort();
    const current = new AbortController();
    controller = current;
    pageStatus.value = 'loading';
    errorMessage.value = '';
    try {
      const result = await getRecommendationProfile(token, current.signal);
      if (disposed || current.signal.aborted) return;
      profile.value = result;
      pageStatus.value = 'success';
    } catch (error) {
      if (disposed || current.signal.aborted) return;
      pageStatus.value = 'error';
      errorMessage.value =
        error instanceof Error ? error.message : '推荐画像加载失败';
    } finally {
      if (controller === current) controller = null;
    }
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    const token = auth.state.token;
    if (!token || isMutating.value) return;
    mutationStatus.value = 'submitting';
    mutationError.value = '';
    try {
      await updateRecommendationSettings(token, enabled);
      if (disposed) return;
      profile.value.learningEnabled = enabled;
      mutationStatus.value = 'idle';
      toast.success(enabled ? '推荐学习已开启' : '推荐学习已关闭');
    } catch (error) {
      if (disposed) return;
      mutationStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      mutationError.value =
        error instanceof Error ? error.message : '推荐设置更新失败';
    }
  }

  async function clear(): Promise<void> {
    const token = auth.state.token;
    if (!token || isMutating.value) return;
    mutationStatus.value = 'submitting';
    mutationError.value = '';
    try {
      await clearRecommendationProfile(token);
      if (disposed) return;
      const learningEnabled = profile.value.learningEnabled;
      profile.value = { ...emptyProfile(), learningEnabled };
      mutationStatus.value = 'idle';
      toast.success('推荐画像已清空');
    } catch (error) {
      if (disposed) return;
      mutationStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      mutationError.value =
        error instanceof Error ? error.message : '推荐画像清空失败';
    }
  }

  onMounted(() => void load());
  onBeforeUnmount(() => {
    disposed = true;
    controller?.abort();
  });

  return {
    profile,
    pageStatus,
    mutationStatus,
    errorMessage,
    mutationError,
    isLoading,
    isMutating,
    load,
    setEnabled,
    clear,
  };
}
