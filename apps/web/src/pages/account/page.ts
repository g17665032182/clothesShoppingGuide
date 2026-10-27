import { computed, ref } from 'vue';
import { updateCurrentProfile } from '@/api/modules/users';
import { auth } from '@/lib/auth';

export function useAccountPage() {
  const displayName = ref(auth.state.user?.displayName ?? '');
  const password = ref('');
  const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle');
  const error = ref('');

  const user = computed(() => auth.state.user);
  const pending = computed(() => status.value === 'loading');

  async function saveProfile() {
    if (!auth.state.token) return;

    status.value = 'loading';
    error.value = '';
    try {
      const payload: { displayName?: string; password?: string } = {
        displayName: displayName.value,
      };
      if (password.value) payload.password = password.value;
      await updateCurrentProfile(auth.state.token, payload);
      password.value = '';
      await auth.refreshUser();
      status.value = 'success';
    } catch (cause) {
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
