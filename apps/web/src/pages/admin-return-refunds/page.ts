import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { toast } from 'vue-sonner';
import { ApiError } from '@/api';
import {
  approveReturnRefund,
  completeReturnRefund,
  getAdminReturnRefundApplication,
  listAdminReturnRefundApplications,
  receiveReturnRefund,
  rejectReturnRefund,
  startReturnRefund,
} from '@/api/modules/admin-return-refunds';
import type {
  AdminReturnRefundApplication,
  AdminReturnRefundApplicationPage,
  AdminReturnRefundQuery,
} from '@/api/types/admin-return-refunds';
import type { ReturnRefundStatus } from '@/api/types/return-refund';
import { useErrorToast } from '@/composables/use-error-toast';
import { auth } from '@/lib/auth';

type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';
type DetailStatus = AsyncStatus | 'unknown';
type ActionStatus = 'idle' | 'submitting' | 'unknown' | 'error';

export const adminReturnRefundStatusLabels: Record<ReturnRefundStatus, string> =
  {
    pending_user_submission: '待用户提交',
    pending_review: '待审核',
    approved_pending_return: '待用户寄回',
    returned_by_user: '用户已寄回',
    pending_inspection: '待验货',
    refund_processing: '退款处理中',
    refunded: '本站已登记退款完成',
    rejected: '已拒绝',
    cancelled: '已取消',
  };

export function useAdminReturnRefundsPage() {
  const query = reactive<AdminReturnRefundQuery>({
    page: 1,
    pageSize: 20,
  });
  const pageData = ref<AdminReturnRefundApplicationPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const listStatus = ref<AsyncStatus>('idle');
  const listError = ref('');
  const detailStatus = ref<DetailStatus>('idle');
  const detailError = ref('');
  const selected = ref<AdminReturnRefundApplication | null>(null);
  const selectedId = ref<string | null>(null);
  const detailOpen = ref(false);
  const actionStatus = ref<ActionStatus>('idle');
  const actionError = ref('');
  const rejectionReason = ref('');
  useErrorToast(() => listError.value);
  useErrorToast(() => detailError.value);
  useErrorToast(() => actionError.value);

  let listController: AbortController | null = null;
  let detailController: AbortController | null = null;
  let actionController: AbortController | null = null;
  let listVersion = 0;
  let detailVersion = 0;
  let identityVersion = 0;
  let disposed = false;

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

  function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(pageData.value.total / query.pageSize)),
  );

  async function loadApplications(): Promise<void> {
    const token = auth.state.token;
    if (!token) return;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    const requestVersion = ++listVersion;
    const identity = identityVersion;
    const userId = auth.state.user?.id;
    listStatus.value = 'loading';
    listError.value = '';
    try {
      const result = await listAdminReturnRefundApplications(
        token,
        { ...query },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        requestVersion !== listVersion ||
        !currentIdentity(identity, userId)
      )
        return;
      const lastPage = Math.max(1, Math.ceil(result.total / query.pageSize));
      if (query.page > lastPage) {
        query.page = lastPage;
        await loadApplications();
        return;
      }
      pageData.value = result;
      listStatus.value = result.items.length ? 'success' : 'empty';
    } catch (error) {
      if (
        !controller.signal.aborted &&
        requestVersion === listVersion &&
        currentIdentity(identity, userId) &&
        !isAbort(error)
      ) {
        listStatus.value = 'error';
        listError.value =
          error instanceof Error ? error.message : '售后申请列表读取失败。';
      }
    }
  }

  async function openDetail(applicationId: string): Promise<void> {
    const token = auth.state.token;
    if (!token || actionStatus.value === 'submitting') return;
    detailController?.abort();
    const controller = new AbortController();
    detailController = controller;
    const requestVersion = ++detailVersion;
    const identity = identityVersion;
    const userId = auth.state.user?.id;
    selectedId.value = applicationId;
    detailOpen.value = true;
    detailStatus.value = 'loading';
    detailError.value = '';
    actionStatus.value = 'idle';
    actionError.value = '';
    rejectionReason.value = '';
    try {
      const result = await getAdminReturnRefundApplication(
        token,
        applicationId,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        requestVersion !== detailVersion ||
        !currentIdentity(identity, userId)
      )
        return;
      selected.value = result;
      detailStatus.value = 'success';
    } catch (error) {
      if (
        !controller.signal.aborted &&
        requestVersion === detailVersion &&
        currentIdentity(identity, userId) &&
        !isAbort(error)
      ) {
        detailStatus.value =
          error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
        detailError.value =
          error instanceof Error ? error.message : '售后申请详情读取失败。';
      }
    }
  }

  async function runAction(
    action:
      'approve' | 'reject' | 'received' | 'refund-processing' | 'refunded',
  ): Promise<void> {
    const token = auth.state.token;
    const current = selected.value;
    if (!token || !current || actionStatus.value === 'submitting') return;
    if (action === 'reject' && !rejectionReason.value.trim()) {
      actionError.value = '拒绝申请时必须填写原因。';
      return;
    }
    const identity = identityVersion;
    const userId = auth.state.user?.id;
    const controller = new AbortController();
    actionController?.abort();
    actionController = controller;
    actionStatus.value = 'submitting';
    actionError.value = '';
    try {
      const payload = { version: current.version };
      const result =
        action === 'approve'
          ? await approveReturnRefund(
              token,
              current.id,
              payload,
              controller.signal,
            )
          : action === 'reject'
            ? await rejectReturnRefund(
                token,
                current.id,
                { ...payload, reason: rejectionReason.value.trim() },
                controller.signal,
              )
            : action === 'received'
              ? await receiveReturnRefund(
                  token,
                  current.id,
                  payload,
                  controller.signal,
                )
              : action === 'refund-processing'
                ? await startReturnRefund(
                    token,
                    current.id,
                    payload,
                    controller.signal,
                  )
                : await completeReturnRefund(
                    token,
                    current.id,
                    payload,
                    controller.signal,
                  );
      if (!currentIdentity(identity, userId)) return;
      selected.value = result;
      actionStatus.value = 'idle';
      toast.success(
        action === 'approve'
          ? '申请已通过'
          : action === 'reject'
            ? '申请已拒绝'
            : action === 'received'
              ? '已登记收到退货'
              : action === 'refund-processing'
                ? '已登记退款处理中'
                : '已登记退款完成',
      );
      await loadApplications();
    } catch (error) {
      if (!currentIdentity(identity, userId)) return;
      actionStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      actionError.value =
        error instanceof Error ? error.message : '状态更新失败，请重新读取。';
      if (actionStatus.value === 'unknown') await openDetail(current.id);
    } finally {
      if (actionController === controller) actionController = null;
    }
  }

  function setFilter<K extends keyof AdminReturnRefundQuery>(
    key: K,
    value: AdminReturnRefundQuery[K],
  ): void {
    query[key] = value;
    query.page = 1;
    void loadApplications();
  }

  function goToPage(page: number): void {
    const target = Math.min(Math.max(1, page), totalPages.value);
    if (target === query.page) return;
    query.page = target;
    void loadApplications();
  }

  function retryDetail(): void {
    if (selectedId.value) void openDetail(selectedId.value);
  }

  watch(
    () => (auth.state.token ? auth.state.user?.id : null),
    () => {
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
      selected.value = null;
      selectedId.value = null;
      detailOpen.value = false;
      listStatus.value = 'idle';
      detailStatus.value = 'idle';
      actionStatus.value = 'idle';
      listError.value = '';
      detailError.value = '';
      actionError.value = '';
      query.page = 1;
      query.status = undefined;
      query.orderNo = undefined;
      query.manualReviewRequired = undefined;
      if (auth.state.token) void loadApplications();
    },
    { flush: 'sync' },
  );

  onMounted(() => void loadApplications());
  onBeforeUnmount(() => {
    disposed = true;
    listController?.abort();
    detailController?.abort();
    actionController?.abort();
  });

  return {
    actionError,
    actionStatus,
    detailError,
    detailOpen,
    detailStatus,
    goToPage,
    listError,
    listStatus,
    loadApplications,
    openDetail,
    pageData,
    query,
    rejectionReason,
    retryDetail,
    runAction,
    setFilter,
    totalPages,
    selected,
  };
}
