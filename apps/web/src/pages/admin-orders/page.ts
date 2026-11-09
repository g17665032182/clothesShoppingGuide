import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { toast } from 'vue-sonner';
import { useErrorToast } from '@/composables/use-error-toast';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import {
  getAdminOrder,
  listAdminOrders,
  shipAdminOrder,
} from '@/api/modules/admin-orders';
import type {
  AdminOrderDetail,
  AdminOrderPage,
  AdminOrderQuery,
  AdminOrderStatus,
  ShipOrderPayload,
} from '@/api/types/admin-orders';
import { auth } from '@/lib/auth';

export const adminOrderStatusLabels: Record<AdminOrderStatus, string> = {
  pending_payment: '待支付',
  pending_shipment: '待发货',
  pending_receipt: '待收货',
  completed: '已完成',
  closed: '已关闭',
};

type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';
type ActionStatus = 'idle' | 'submitting' | 'success' | 'error';

export function useAdminOrdersPage() {
  const route = useRoute();
  const router = useRouter();
  const query = reactive<AdminOrderQuery>({
    page: 1,
    pageSize: 20,
  });
  const pageData = ref<AdminOrderPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const listStatus = ref<AsyncStatus>('idle');
  const detailStatus = ref<AsyncStatus>('idle');
  const listError = ref('');
  const detailError = ref('');
  const selectedOrder = ref<AdminOrderDetail | null>(null);
  const selectedOrderId = ref<string | null>(null);
  const detailOpen = ref(false);
  const shipDialogOpen = ref(false);
  const shipStatus = ref<ActionStatus>('idle');
  const shipError = ref('');
  useErrorToast(() => listError.value);
  useErrorToast(() => detailError.value);
  useErrorToast(() => shipError.value);

  let listController: AbortController | null = null;
  let detailController: AbortController | null = null;
  let shipController: AbortController | null = null;
  let listVersion = 0;
  let detailVersion = 0;
  let pendingQuery: LocationQueryRaw | null = null;
  let querySyncRunning = false;
  let disposed = false;

  function readRouteQuery(): AdminOrderQuery {
    const rawPage = Number(route.query.page);
    const rawPageSize = Number(route.query.pageSize);
    const status =
      typeof route.query.status === 'string' &&
      Object.hasOwn(adminOrderStatusLabels, route.query.status)
        ? (route.query.status as AdminOrderStatus)
        : undefined;
    return {
      page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
      pageSize:
        Number.isSafeInteger(rawPageSize) &&
        rawPageSize > 0 &&
        rawPageSize <= 100
          ? rawPageSize
          : 20,
      status,
      orderNo:
        typeof route.query.orderNo === 'string'
          ? route.query.orderNo.trim().slice(0, 100) || undefined
          : undefined,
      userId:
        typeof route.query.userId === 'string'
          ? route.query.userId.trim() || undefined
          : undefined,
    };
  }

  Object.assign(query, readRouteQuery());

  function persistQuery(): void {
    pendingQuery = {
      page: String(query.page),
      pageSize: String(query.pageSize),
      ...(query.status ? { status: query.status } : {}),
      ...(query.orderNo ? { orderNo: query.orderNo } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    if (!querySyncRunning) void syncQueuedQuery();
  }

  async function syncQueuedQuery(): Promise<void> {
    querySyncRunning = true;
    try {
      // 连续筛选仅保留最新待写地址；旧导航完成时不能恢复较旧的页面状态。
      while (pendingQuery && !disposed) {
        const nextQuery = pendingQuery;
        pendingQuery = null;
        await router.replace({ query: nextQuery });
      }
    } catch {
      if (!disposed) listError.value = '筛选条件未能同步到地址栏，请重试。';
    } finally {
      querySyncRunning = false;
    }
  }

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(pageData.value.total / query.pageSize)),
  );
  const canPrevious = computed(() => query.page > 1);
  const canNext = computed(() => query.page < totalPages.value);
  const canShip = computed(
    () =>
      detailStatus.value === 'success' &&
      selectedOrder.value?.status === 'pending_shipment',
  );

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  async function loadOrders(): Promise<void> {
    const token = auth.state.token;
    if (!token) return;
    if (
      query.userId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        query.userId,
      )
    ) {
      listController?.abort();
      listStatus.value = 'error';
      listError.value = '请输入有效的买家 UUID。';
      return;
    }

    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    const version = ++listVersion;
    listStatus.value = 'loading';
    listError.value = '';

    try {
      const result = await listAdminOrders(
        token,
        { ...query },
        controller.signal,
      );
      if (disposed || controller.signal.aborted || version !== listVersion)
        return;
      const lastPage = Math.max(1, Math.ceil(result.total / query.pageSize));
      if (query.page > lastPage) {
        query.page = lastPage;
        persistQuery();
        await loadOrders();
        return;
      }
      pageData.value = result;
      listStatus.value = result.items.length ? 'success' : 'empty';
    } catch (error) {
      if (
        disposed ||
        controller.signal.aborted ||
        version !== listVersion ||
        isAbortError(error)
      )
        return;
      listStatus.value = 'error';
      listError.value =
        error instanceof Error ? error.message : '无法读取订单列表。';
    }
  }

  async function openOrder(
    orderId: string,
    preserveDetail = false,
  ): Promise<void> {
    const token = auth.state.token;
    if (!token || shipStatus.value === 'submitting') return;

    detailController?.abort();
    const controller = new AbortController();
    detailController = controller;
    const version = ++detailVersion;
    selectedOrderId.value = orderId;
    detailStatus.value = 'loading';
    detailError.value = '';
    if (!preserveDetail || selectedOrder.value?.id !== orderId)
      selectedOrder.value = null;

    try {
      const result = await getAdminOrder(token, orderId, controller.signal);
      if (disposed || controller.signal.aborted || version !== detailVersion)
        return;
      selectedOrder.value = result;
      detailStatus.value = 'success';
    } catch (error) {
      if (
        disposed ||
        controller.signal.aborted ||
        version !== detailVersion ||
        isAbortError(error)
      )
        return;
      detailStatus.value = selectedOrder.value ? 'success' : 'error';
      detailError.value =
        error instanceof Error ? error.message : '无法读取订单详情。';
    }
  }

  function setFilter<K extends keyof AdminOrderQuery>(
    key: K,
    value: AdminOrderQuery[K],
  ): void {
    query[key] = value;
    query.page = 1;
    persistQuery();
    void loadOrders();
  }

  function goToPage(page: number): void {
    const target = Math.min(Math.max(1, page), totalPages.value);
    if (target === query.page) return;
    query.page = target;
    persistQuery();
    void loadOrders();
  }

  function openShipDialog(): void {
    if (!canShip.value) return;
    shipError.value = '';
    shipStatus.value = 'idle';
    shipDialogOpen.value = true;
    detailOpen.value = false;
  }

  function viewOrder(orderId: string): void {
    if (shipStatus.value === 'submitting' || shipDialogOpen.value) return;
    detailOpen.value = true;
    void openOrder(orderId);
  }

  function resetFilters(): void {
    query.orderNo = undefined;
    query.userId = undefined;
    query.status = undefined;
    query.page = 1;
    persistQuery();
    void loadOrders();
  }

  function retryDetail(): void {
    if (selectedOrderId.value && shipStatus.value !== 'submitting')
      void openOrder(selectedOrderId.value, true);
  }

  async function submitShipment(payload: ShipOrderPayload): Promise<boolean> {
    const token = auth.state.token;
    const orderId = selectedOrder.value?.id;
    if (
      !token ||
      !orderId ||
      !canShip.value ||
      shipStatus.value === 'submitting'
    ) {
      return false;
    }
    const normalizedPayload = {
      carrier: payload.carrier.trim(),
      trackingNo: payload.trackingNo.trim(),
    };
    if (
      Object.values(normalizedPayload).some(
        (value) =>
          !value || value.length > 100 || /[\u0000-\u001f\u007f]/u.test(value),
      )
    ) {
      shipStatus.value = 'error';
      shipError.value = '请填写 1–100 个字符的物流信息，且不能包含控制字符。';
      return false;
    }

    shipController?.abort();
    const controller = new AbortController();
    shipController = controller;
    shipStatus.value = 'submitting';
    shipError.value = '';

    try {
      const result = await shipAdminOrder(
        token,
        orderId,
        normalizedPayload,
        controller.signal,
      );
      if (disposed || controller.signal.aborted) return false;
      selectedOrder.value = result;
      shipStatus.value = 'success';
      toast.success('订单已发货');
      shipDialogOpen.value = false;
      detailOpen.value = true;
      detailStatus.value = 'success';
      // 发货结果已提交，刷新失败仅更新列表/详情错误，不回退为发货失败。
      await openOrder(orderId, true);
      await loadOrders();
      return true;
    } catch (error) {
      if (disposed || controller.signal.aborted || isAbortError(error))
        return false;
      shipStatus.value = 'error';
      shipError.value =
        error instanceof Error ? error.message : '发货失败，请重试。';
      return false;
    }
  }

  onMounted(() => {
    void loadOrders();
  });

  watch(
    () => route.query,
    () => {
      if (querySyncRunning || disposed) return;
      const next = readRouteQuery();
      if (JSON.stringify(next) === JSON.stringify({ ...query })) return;
      Object.assign(query, next);
      void loadOrders();
    },
    { flush: 'sync' },
  );

  watch(detailOpen, (open) => {
    if (open) return;
    detailVersion += 1;
    detailController?.abort();
  });

  onBeforeUnmount(() => {
    disposed = true;
    pendingQuery = null;
    listController?.abort();
    detailController?.abort();
    shipController?.abort();
  });

  return {
    adminOrderStatusLabels,
    canNext,
    canPrevious,
    canShip,
    detailError,
    detailOpen,
    detailStatus,
    goToPage,
    listError,
    listStatus,
    loadOrders,
    openOrder,
    openShipDialog,
    pageData,
    query,
    selectedOrder,
    resetFilters,
    retryDetail,
    setFilter,
    shipDialogOpen,
    shipError,
    shipStatus,
    submitShipment,
    totalPages,
    viewOrder,
  };
}
