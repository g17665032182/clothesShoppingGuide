import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { useErrorToast } from '@/composables/use-error-toast';
import { ApiError } from '@/api';
import { getCaptcha } from '@/api/modules/auth';
import { auth } from '@/lib/auth';

const CAPTCHA_REFRESH_COOLDOWN_SECONDS = 60;

export function useAuthPage() {
  const route = useRoute();
  const router = useRouter();
  const isRegister = computed(() => route.name === 'register');
  const email = ref('');
  const password = ref('');
  const displayName = ref('');
  const captchaAnswer = ref('');
  const captchaChallengeId = ref('');
  const captchaImage = ref('');
  const captchaPending = ref(false);
  const captchaCountdown = ref(0);
  const error = ref('');
  useErrorToast(() => error.value);
  const pending = ref(false);
  let captchaTimer: ReturnType<typeof setInterval> | null = null;
  let captchaRequest: AbortController | null = null;
  let captchaRequestSequence = 0;

  function clearCaptchaTimer() {
    if (captchaTimer) {
      clearInterval(captchaTimer);
      captchaTimer = null;
    }
  }

  function startCaptchaCountdown() {
    clearCaptchaTimer();
    captchaCountdown.value = CAPTCHA_REFRESH_COOLDOWN_SECONDS;
    captchaTimer = setInterval(() => {
      captchaCountdown.value -= 1;
      if (captchaCountdown.value <= 0) clearCaptchaTimer();
    }, 1_000);
  }

  async function loadCaptcha() {
    if (isRegister.value) return;

    captchaRequest?.abort();
    const request = new AbortController();
    captchaRequest = request;
    const requestSequence = ++captchaRequestSequence;
    captchaPending.value = true;

    try {
      const response = await getCaptcha(request.signal);
      if (requestSequence !== captchaRequestSequence) return;
      captchaChallengeId.value = response.challengeId;
      captchaImage.value = response.imageData;
      captchaAnswer.value = '';
      startCaptchaCountdown();
    } catch (cause) {
      if (
        request.signal.aborted ||
        requestSequence !== captchaRequestSequence
      ) {
        return;
      }
      error.value =
        cause instanceof Error ? cause.message : '验证码加载失败，请稍后重试。';
    } finally {
      if (requestSequence === captchaRequestSequence) {
        captchaPending.value = false;
      }
    }
  }

  async function refreshCaptcha() {
    if (pending.value || captchaPending.value || captchaCountdown.value > 0) {
      return;
    }
    error.value = '';
    await loadCaptcha();
  }

  async function submit() {
    if (pending.value || captchaPending.value) return;
    error.value = '';
    pending.value = true;
    let loginAttempted = false;
    try {
      if (isRegister.value) {
        await auth.register(email.value, password.value, displayName.value);
        await router.push('/account');
        toast.success('注册成功');
      } else {
        if (!captchaChallengeId.value || !captchaAnswer.value.trim()) {
          throw new Error('请先获取并填写验证码');
        }
        loginAttempted = true;
        await auth.signIn(
          email.value,
          password.value,
          captchaChallengeId.value,
          captchaAnswer.value,
        );
        await router.push('/chat');
        toast.success('登录成功');
      }
    } catch (cause) {
      error.value =
        cause instanceof ApiError && cause.status === 409
          ? '该邮箱已注册，请直接登录。'
          : cause instanceof Error
            ? cause.message
            : '操作失败，请稍后重试。';
      if (loginAttempted) {
        // 挑战提交后已被消费，清空旧图并解除冷却，允许用户立即手动获取新图。
        clearCaptchaTimer();
        captchaCountdown.value = 0;
        captchaChallengeId.value = '';
        captchaAnswer.value = '';
        captchaImage.value = '';
      }
    } finally {
      pending.value = false;
    }
  }

  watch(
    isRegister,
    (register) => {
      if (register) {
        captchaRequest?.abort();
        captchaRequestSequence += 1;
        captchaPending.value = false;
        clearCaptchaTimer();
        captchaChallengeId.value = '';
        captchaImage.value = '';
        captchaAnswer.value = '';
        captchaCountdown.value = 0;
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    captchaRequest?.abort();
    captchaRequestSequence += 1;
    clearCaptchaTimer();
  });

  return {
    captchaAnswer,
    captchaCountdown,
    captchaImage,
    captchaPending,
    displayName,
    email,
    error,
    isRegister,
    password,
    pending,
    refreshCaptcha,
    submit,
  };
}
