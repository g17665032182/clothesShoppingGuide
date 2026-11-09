import { computed, onBeforeUnmount, ref } from 'vue';
import { toast } from 'vue-sonner';
import { useErrorToast } from '@/composables/use-error-toast';
import { updateCurrentProfile } from '@/api/modules/users';
import { auth } from '@/lib/auth';

export function useAccountPage() {
  const displayName = ref(auth.state.user?.displayName ?? '');
  const password = ref('');
  const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle');
  const error = ref('');
  useErrorToast(() => error.value);
  let disposed = false;
  onBeforeUnmount(() => {
    disposed = true;
  });

  const user = computed(() => auth.state.user);
  const pending = computed(() => status.value === 'loading');

  async function saveProfile() {
    if (!auth.state.token || pending.value) return;
    const userId = auth.state.user?.id;
    const isCurrent = () => !disposed && userId === auth.state.user?.id;

    status.value = 'loading';
    error.value = '';
    try {
      const payload: { displayName?: string; password?: string } = {
        displayName: displayName.value,
      };
      if (password.value) payload.password = password.value;
      await updateCurrentProfile(auth.state.token, payload);
      if (!isCurrent()) return;
      password.value = '';
      await auth.refreshUser();
      if (!isCurrent()) return;
      status.value = 'success';
      toast.success('账户资料已更新');
    } catch (cause) {
      if (!isCurrent()) return;
      status.value = 'error';
      error.value = cause instanceof Error ? cause.message : '保存失败。';
    }
  }

  return {
    displayName,
    error,
    password,
    pending,
    saveProfile,
    status,
    user,
  };
}
