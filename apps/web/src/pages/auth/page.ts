import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api';
import { auth } from '@/lib/auth';

export function useAuthPage() {
  const route = useRoute();
  const router = useRouter();
  const isRegister = computed(() => route.name === 'register');
  const email = ref('');
  const password = ref('');
  const displayName = ref('');
  const error = ref('');
  const pending = ref(false);

  async function submit() {
    error.value = '';
    pending.value = true;
    try {
      if (isRegister.value) {
        await auth.register(email.value, password.value, displayName.value);
      } else {
        await auth.signIn(email.value, password.value);
      }
      await router.push(auth.isAdmin.value ? '/admin/users' : '/account');
    } catch (cause) {
      error.value =
        cause instanceof ApiError && cause.status === 409
          ? '该邮箱已注册，请直接登录。'
          : cause instanceof Error
            ? cause.message
            : '操作失败，请稍后重试。';
    } finally {
      pending.value = false;
    }
  }

  return {
    displayName,
    email,
    error,
    isRegister,
    password,
    pending,
    submit,
  };
}
