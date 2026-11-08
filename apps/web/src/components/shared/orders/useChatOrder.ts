import { onBeforeUnmount, ref, watch } from 'vue';
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
  'idle' | 'loading' | 'success' | 'empty' | 'error' | 'unknown';
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

  async function runAction(action: OrderAction): Promise<void> {
    const token = auth.state.token;
    const currentOrder = order.value;
    if (
      !token ||
      !currentOrder ||
      detailStatus.value !== 'success' ||
      actionStatus.value === 'submitting'
    )
      return;
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
      if (controller.signal.aborted || !isCurrent(identity, userId)) return;
      order.value = updated;
      detailStatus.value = 'success';
      actionStatus.value = 'idle';
    } catch (cause) {
      if (controller.signal.aborted || !isCurrent(identity, userId)) return;
      actionStatus.value =
        cause instanceof ApiError && cause.status === 0 ? 'unknown' : 'error';
      error.value =
        cause instanceof Error ? cause.message : '订单操作失败，正在重新读取';
      if (cause instanceof ApiError && cause.status === 409) {
        actionStatus.value = 'idle';
        await loadOrder(currentOrder.id);
      } else if (cause instanceof ApiError && cause.status === 0) {
        detailStatus.value = 'unknown';
      }
    }
  }

  async function confirmAction(): Promise<void> {
    actionDialogOpen.value = false;
    await runAction(actionType.value);
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
    requestAction,
    confirmAction,
    pay,
  };
}
