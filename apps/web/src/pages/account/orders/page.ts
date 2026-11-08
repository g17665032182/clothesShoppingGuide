import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import {
  getOrder,
  listOrders,
  cancelOrder,
  confirmReceipt,
  simulatePayment,
} from '@/api/modules/orders';
import { ApiError } from '@/api';
import type {
  OrderDetail,
  OrderPage,
  OrderQuery,
  OrderStatus,
} from '@/api/types/orders';
import { auth } from '@/lib/auth';

type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';
type DetailStatus = AsyncStatus | 'unknown';
type ActionStatus = 'idle' | 'submitting' | 'unknown' | 'error';

export function useOrdersPage() {
  const query = reactive<OrderQuery>({ page: 1, pageSize: 20 });
  const pageData = ref<OrderPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const listStatus = ref<AsyncStatus>('idle');
  const listError = ref('');
  const detailStatus = ref<DetailStatus>('idle');
  const detailError = ref('');
  const selectedOrder = ref<OrderDetail | null>(null);
  const selectedOrderId = ref<string | null>(null);
  const detailOpen = ref(false);
  const actionStatus = ref<ActionStatus>('idle');
  const actionError = ref('');
  const actionDialogOpen = ref(false);
  const actionType = ref<'cancel' | 'receipt'>('cancel');
  let listController: AbortController | null = null;
  let detailController: AbortController | null = null;
  let listVersion = 0;
  let detailVersion = 0;
  let identityVersion = 0;
  let disposed = false;
  let actionController: AbortController | null = null;

  function currentIdentity(
    version: number,
    userId: string | undefined,
  ): boolean {
    return (
      !disposed &&
      version === identityVersion &&
      userId === (auth.state.token ? auth.state.user?.id : undefined)
    );
  }

  watch(
    () => (auth.state.token ? auth.state.user?.id : null),
    () => {
      // 账号变化时同时作废旧请求并清除页面数据，避免同一页面承接上个账号结果。
      identityVersion += 1;
      listVersion += 1;
      detailVersion += 1;
      listController?.abort();
      detailController?.abort();
      actionController?.abort();
      listController = null;
      detailController = null;
      actionController = null;
      pageData.value = { items: [], total: 0, page: 1, pageSize: 20 };
      selectedOrder.value = null;
      selectedOrderId.value = null;
      detailOpen.value = false;
      listStatus.value = 'idle';
      detailStatus.value = 'idle';
      actionStatus.value = 'idle';
      listError.value = '';
      detailError.value = '';
      actionError.value = '';
      query.page = 1;
      query.orderNo = undefined;
      query.status = undefined;
      if (auth.state.token) void loadOrders();
    },
    { flush: 'sync' },
  );

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(pageData.value.total / query.pageSize)),
  );

  function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  async function loadOrders(): Promise<void> {
    const token = auth.state.token;
    if (!token) return;
    const versionIdentity = identityVersion;
    const userId = auth.state.user?.id;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    const version = ++listVersion;
    listStatus.value = 'loading';
    listError.value = '';
    try {
      const result = await listOrders(token, { ...query }, controller.signal);
      if (
        controller.signal.aborted ||
        version !== listVersion ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      const lastPage = Math.max(1, Math.ceil(result.total / query.pageSize));
      if (query.page > lastPage) {
        query.page = lastPage;
        await loadOrders();
        return;
      }
      pageData.value = result;
      listStatus.value = result.items.length ? 'success' : 'empty';
    } catch (error) {
      if (
        !controller.signal.aborted &&
        version === listVersion &&
        currentIdentity(versionIdentity, userId) &&
        !isAbort(error)
      ) {
        listStatus.value = 'error';
        listError.value =
          error instanceof Error ? error.message : '订单列表加载失败';
      }
    }
  }

  async function openOrder(id: string): Promise<void> {
    const token = auth.state.token;
    if (!token || actionStatus.value === 'submitting') return;
    const versionIdentity = identityVersion;
    const userId = auth.state.user?.id;
    detailController?.abort();
    const controller = new AbortController();
    detailController = controller;
    const version = ++detailVersion;
    selectedOrderId.value = id;
    detailOpen.value = true;
    detailStatus.value = 'loading';
    detailError.value = '';
    actionStatus.value = 'idle';
    actionError.value = '';
    try {
      const result = await getOrder(token, id, controller.signal);
      if (
        controller.signal.aborted ||
        version !== detailVersion ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      selectedOrder.value = result;
      detailStatus.value = 'success';
    } catch (error) {
      if (
        !controller.signal.aborted &&
        version === detailVersion &&
        currentIdentity(versionIdentity, userId) &&
        !isAbort(error)
      ) {
        detailStatus.value =
          error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
        detailError.value =
          error instanceof Error ? error.message : '订单详情加载失败';
      }
    }
  }

  function setStatus(status: OrderStatus | undefined): void {
    query.status = status;
    query.page = 1;
    void loadOrders();
  }

  function setOrderNo(orderNo: string): void {
    query.orderNo = orderNo.trim() || undefined;
    query.page = 1;
    void loadOrders();
  }

  function goToPage(page: number): void {
    if (page < 1 || page > totalPages.value || page === query.page) return;
    query.page = page;
    void loadOrders();
  }

  function requestAction(action: 'cancel' | 'receipt'): void {
    if (!selectedOrder.value) return;
    actionType.value = action;
    actionDialogOpen.value = true;
  }

  async function requestPayment(): Promise<void> {
    await runAction('pay');
  }

  async function confirmAction(): Promise<void> {
    actionDialogOpen.value = false;
    await runAction(actionType.value);
  }

  async function runAction(
    action: 'pay' | 'cancel' | 'receipt',
  ): Promise<void> {
    const token = auth.state.token;
    const orderId = selectedOrder.value?.id;
    if (!token || !orderId || actionStatus.value === 'submitting') return;
    const versionIdentity = identityVersion;
    const userId = auth.state.user?.id;
    const controller = new AbortController();
    actionController?.abort();
    actionController = controller;
    actionStatus.value = 'submitting';
    actionError.value = '';
    try {
      const result =
        action === 'pay'
          ? await simulatePayment(token, orderId, controller.signal)
          : action === 'cancel'
            ? await cancelOrder(token, orderId, controller.signal)
            : await confirmReceipt(token, orderId, controller.signal);
      if (
        controller.signal.aborted ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      selectedOrder.value = result;
      actionStatus.value = 'idle';
      await loadOrders();
    } catch (error) {
      if (
        controller.signal.aborted ||
        !currentIdentity(versionIdentity, userId)
      )
        return;
      actionStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      actionError.value =
        error instanceof Error ? error.message : '订单操作失败，请重新读取';
      await openOrder(orderId);
    } finally {
      if (actionController === controller) actionController = null;
    }
  }

  function retryDetail(): void {
    if (selectedOrderId.value) void openOrder(selectedOrderId.value);
  }

  onMounted(() => void loadOrders());
  onBeforeUnmount(() => {
    disposed = true;
    listController?.abort();
    detailController?.abort();
    actionController?.abort();
  });

  return {
    query,
    pageData,
    listStatus,
    listError,
    detailStatus,
    detailError,
    selectedOrder,
    detailOpen,
    actionStatus,
    actionError,
    actionDialogOpen,
    actionType,
    totalPages,
    loadOrders,
    openOrder,
    setStatus,
    setOrderNo,
    goToPage,
    requestAction,
    requestPayment,
    confirmAction,
    retryDetail,
  };
}
