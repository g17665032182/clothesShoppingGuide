import { onScopeDispose, useId, watch } from 'vue';
import { toast } from 'vue-sonner';

export function useErrorToast(message: () => string | null | undefined) {
  const prefix = `error-${useId()}`;
  let sequence = 0;
  let activeId: string | undefined;

  // 可见提示复用 ID；关闭后使用新 ID，避免快速重试复用正在退出的提示。
  watch(
    message,
    (value) => {
      if (!value) return;
      const id = activeId ?? `${prefix}-${++sequence}`;
      activeId = id;
      const release = () => {
        if (activeId === id) activeId = undefined;
      };
      // 自动核实会清空错误状态，但提示仍保留到用户关闭或超时。
      toast.error(value, {
        id,
        duration: 7000,
        onDismiss: release,
        onAutoClose: release,
      });
    },
    { immediate: true, flush: 'sync' },
  );
  onScopeDispose(() => {
    if (activeId) toast.dismiss(activeId);
  });
}
