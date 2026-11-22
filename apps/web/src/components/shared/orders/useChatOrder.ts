import { onBeforeUnmount, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { useErrorToast } from '@/composables/use-error-toast';
import { ApiError } from '@/api';
import {
  cancelOrder,
  confirmReceipt,
  getOrder,
  simulatePayment,
} from '@/api/modules/orders';
import type { OrderDetail } from '@/api/types/orders';
import { auth } from '@/lib/auth';

type DetailStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'empty'
  | 'error'
  | 'unknown';
type ActionStatus = 'idle' | 'submitting' | 'unknown' | 'error';
type OrderAction = 'pay' | 'cancel' | 'receipt';

export function useChatOrder() {
  const detailOpen = ref(false);
  const actionDialogOpen = ref(false);
  const actionType = ref<'cancel' | 'receipt'>('cancel');
  const order = ref<OrderDetail | null>(null);
  const orderId = ref<string | null>(null);
  const detailStatus = ref<DetailStatus>('idle');
  const actionStatus = ref<ActionStatus>('idle');
  const error = ref('');
  useErrorToast(() => error.value);
  let identityVersion = 0;
  let disposed = false;
  let requestVersion = 0;
  let requestController: AbortController | null = null;

  function isCurrent(version: number, userId: string | undefined): boolean {
    // 请求结果必须同时属于当前账号 epoch 和账号 ID，避免复用会话时串写。
    return (
      !disposed &&
      version === identityVersion &&
      userId === (auth.state.token ? auth.state.user?.id : undefined)
    );
  }

  watch(
    () => (auth.state.token ? auth.state.user?.id : null),
    () => {
      identityVersion += 1;
      requestVersion += 1;
      requestController?.abort();
      requestController = null;
      order.value = null;
      orderId.value = null;
      detailOpen.value = false;
      actionDialogOpen.value = false;
      detailStatus.value = 'idle';
      actionStatus.value = 'idle';
      error.value = '';
    },
    { flush: 'sync' },
  );

  async function loadOrder(id = orderId.value): Promise<void> {
    const token = auth.state.token;
    if (!token || !id || actionStatus.value === 'submitting') return;
    const identity = identityVersion;
    const userId = auth.state.user?.id;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    const version = ++requestVersion;
    orderId.value = id;
    detailOpen.value = true;
    detailStatus.value = 'loading';
    actionStatus.value = 'idle';
    error.value = '';
    try {
      const result = await getOrder(token, id, controller.signal);
      if (
        controller.signal.aborted ||
        version !== requestVersion ||
        !isCurrent(identity, userId)
      )
        return;
      order.value = result;
      detailStatus.value = 'success';
    } catch (cause) {
      if (
        controller.signal.aborted ||
        version !== requestVersion ||
        !isCurrent(identity, userId)
      )
        return;
      detailStatus.value =
        cause instanceof ApiError && cause.status === 0 ? 'unknown' : 'error';
      error.value = cause instanceof Error ? cause.message : '订单读取失败';
    }
  }

  async function requestCancelForCandidate(
    id: string,
    contextIsCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    const token = auth.state.token;
    if (!token || !id || actionStatus.value === 'submitting') return false;
    const identity = identityVersion;
    const userId = auth.state.user?.id;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    const version = ++requestVersion;
    orderId.value = id;
    detailOpen.value = false;
    detailStatus.value = 'loading';
    actionStatus.value = 'idle';
    error.value = '';
    try {
      const result = await getOrder(token, id, controller.signal);
      if (
        controller.signal.aborted ||
        version !== requestVersion ||
        !isCurrent(identity, userId) ||
        !contextIsCurrent()
      )
        return false;
      order.value = result;
      detailStatus.value = 'success';
      if (
        result.status !== 'pending_payment' ||
        Date.parse(result.expiresAt) <= Date.now()
      ) {
        detailStatus.value = 'error';
        error.value = '此订单已不符合取消条件，请在我的订单中核实最新状态';
        return false;
      }
      actionType.value = 'cancel';
      actionDialogOpen.value = true;
      return true;
    } catch (cause) {
      if (
        controller.signal.aborted ||
        version !== requestVersion ||
        !isCurrent(identity, userId) ||
        !contextIsCurrent()
      )
        return false;
      detailStatus.value =
        cause instanceof ApiError && cause.status === 0 ? 'unknown' : 'error';
      error.value = cause instanceof Error ? cause.message : '订单读取失败';
      return false;
    } finally {
      if (requestController === controller) requestController = null;
    }
  }

  function requestAction(action: 'cancel' | 'receipt'): void {
    if (
      !order.value ||
      detailStatus.value !== 'success' ||
      actionStatus.value !== 'idle'
    )
      return;
    actionType.value = action;
    actionDialogOpen.value = true;
  }

  async function runAction(
    action: OrderAction,
    contextIsCurrent: () => boolean = () => true,
    candidateAction = false,
  ): Promise<OrderDetail | null> {
    const token = auth.state.token;
    const currentOrder = order.value;
    if (
      !token ||
      !currentOrder ||
      detailStatus.value !== 'success' ||
      actionStatus.value === 'submitting' ||
      !contextIsCurrent()
    )
      return null;
    const identity = identityVersion;
    const userId = auth.state.user?.id;
    const controller = new AbortController();
    requestController?.abort();
    requestController = controller;
    actionStatus.value = 'submitting';
    error.value = '';
    try {
      const updated =
        action === 'pay'
          ? await simulatePayment(token, currentOrder.id, controller.signal)
          : action === 'cancel'
            ? await cancelOrder(token, currentOrder.id, controller.signal)
            : await confirmReceipt(token, currentOrder.id, controller.signal);
      if (
        controller.signal.aborted ||
        !isCurrent(identity, userId) ||
        !contextIsCurrent()
      )
        return null;
      order.value = updated;
      detailStatus.value = 'success';
      actionStatus.value = 'idle';
      toast.success(
        action === 'pay'
          ? '模拟支付成功'
          : action === 'cancel'
            ? '订单已取消'
            : '已确认收货',
      );
      return updated;
    } catch (cause) {
      if (
        controller.signal.aborted ||
        !isCurrent(identity, userId) ||
        !contextIsCurrent()
      )
        return null;
      actionStatus.value =
        cause instanceof ApiError && cause.status === 0 ? 'unknown' : 'error';
      error.value =
        cause instanceof Error ? cause.message : '订单操作失败，正在重新读取';
      if (cause instanceof ApiError && cause.status === 409) {
        actionStatus.value = 'idle';
        if (!candidateAction) {
          await loadOrder(currentOrder.id);
        } else {
          try {
            const refreshed = await getOrder(
              token,
              currentOrder.id,
              controller.signal,
            );
            if (
              controller.signal.aborted ||
              !isCurrent(identity, userId) ||
              !contextIsCurrent()
            )
              return null;
            order.value = refreshed;
            detailStatus.value = 'success';
            error.value =
              refreshed.status === 'pending_payment' &&
              Date.parse(refreshed.expiresAt) > Date.now()
                ? '订单状态已更新，请重新确认后操作'
                : '此订单已不符合取消条件，请核实最新状态';
          } catch (refreshError) {
            if (
              controller.signal.aborted ||
              !isCurrent(identity, userId) ||
              !contextIsCurrent()
            )
              return null;
            detailStatus.value =
              refreshError instanceof ApiError && refreshError.status === 0
                ? 'unknown'
                : 'error';
            error.value =
              refreshError instanceof Error
                ? refreshError.message
                : '订单状态刷新失败';
            if (detailStatus.value === 'unknown') detailOpen.value = true;
          }
        }
      } else if (cause instanceof ApiError && cause.status === 0) {
        detailStatus.value = 'unknown';
        if (candidateAction) detailOpen.value = true;
      }
      return null;
    }
  }

  async function confirmAction(
    contextIsCurrent: () => boolean = () => true,
    candidateAction = false,
  ): Promise<OrderDetail | null> {
    actionDialogOpen.value = false;
    return runAction(actionType.value, contextIsCurrent, candidateAction);
  }

  async function pay(): Promise<void> {
    await runAction('pay');
  }

  function dispose(): void {
    disposed = true;
    requestController?.abort();
  }

  onBeforeUnmount(dispose);

  return {
    detailOpen,
    actionDialogOpen,
    actionType,
    order,
    detailStatus,
    actionStatus,
    error,
    loadOrder,
    requestCancelForCandidate,
    requestAction,
    confirmAction,
    pay,
  };
}
