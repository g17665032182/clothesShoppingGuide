import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { useErrorToast } from '@/composables/use-error-toast';
import { auth } from '@/lib/auth';
import { useChatStore } from '@/stores/chat';
import type { PatchPurchasePayload } from '@/api/types/chat-purchase';
import { useChatOrder } from '@/components/shared/orders/useChatOrder';
import {
  createUserAddress,
  listUserAddresses,
} from '@/api/modules/user-addresses';
import type { UserAddress } from '@/api/types/user-addresses';
import { ApiError } from '@/api';
import type {
  ChatAddressSelectionActionStatus,
  ChatAddressSelectionRequest,
  ChatTryOnAction,
} from '@/api/types/chat';
import type {
  ChatDynamicForm,
  ChatDynamicFormResult,
  DynamicFormValues,
} from '@/api/types/chat-dynamic-form';
import {
  cancelDynamicForm,
  getDynamicForm,
  submitDynamicForm,
} from '@/api/modules/chat-dynamic-form';

export function useChatPage() {
  const chat = useChatStore();
  const orderActions = useChatOrder();
  const draft = ref('');
  const replacementProductId = ref<string | null>(null);
  const replacementDialogOpen = ref(false);
  const candidateCancellationSessionKey = ref<string | null>(null);
  const candidateCancellationOrderId = ref<string | null>(null);
  let candidateConfirmationInFlight = false;
  const purchaseDialogOpen = ref(false);
  const purchaseAddresses = ref<UserAddress[]>([]);
  const purchaseAddressStatus = ref<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  );
  const addressSaveStatus = ref<'idle' | 'submitting' | 'unknown' | 'error'>(
    'idle',
  );
  // 只保存每张卡的操作状态，不保存卡片地址详情。
  const addressSelectionStates = ref<
    Record<
      string,
      {
        status: ChatAddressSelectionActionStatus;
        error: string;
      }
    >
  >({});
  let addressListController: AbortController | null = null;
  let addressSaveController: AbortController | null = null;
  let addressListVersion = 0;
  let pendingAddressSave: { fingerprint: string; requestKey: string } | null =
    null;
  let disposed = false;
  const dynamicFormSubmitting = ref<Record<string, boolean>>({});
  const dynamicFormErrors = ref<Record<string, string>>({});
  const dynamicFormControllers = new Map<string, AbortController>();
  useErrorToast(() => chat.errorMessage);
  useErrorToast(() => chat.purchase.errorMessage);
  useErrorToast(() => chat.conversationListError);
  useErrorToast(() => chat.historyError);
  useErrorToast(() =>
    chat.messages
      .flatMap((message) => message.productResults ?? [])
      .map((result) => result.loadMoreError)
      .filter(Boolean)
      .join('\n'),
  );
  const canSend = computed(
    () =>
      draft.value.trim().length > 0 &&
      draft.value.length <= 2000 &&
      chat.canSubmit,
  );

  // 草稿是页面局部状态；切换会话时清理，不随生成任务进入应用级 Store。
  watch(
    () => chat.activeSessionKey,
    () => {
      draft.value = '';
      purchaseDialogOpen.value = false;
      addressListController?.abort();
      addressSaveController?.abort();
      purchaseAddresses.value = [];
      purchaseAddressStatus.value = 'idle';
      addressSaveStatus.value = 'idle';
      pendingAddressSave = null;
      addressSelectionStates.value = {};
      for (const controller of dynamicFormControllers.values())
        controller.abort();
      dynamicFormControllers.clear();
      dynamicFormSubmitting.value = {};
      dynamicFormErrors.value = {};
      replacementDialogOpen.value = false;
      replacementProductId.value = null;
      if (candidateCancellationSessionKey.value !== null) {
        orderActions.actionDialogOpen.value = false;
        candidateCancellationSessionKey.value = null;
        candidateCancellationOrderId.value = null;
      }
    },
    { flush: 'sync' },
  );

  async function loadPurchaseAddresses(): Promise<void> {
    const token = auth.state.token;
    const conversationId = chat.activeConversationId;
    if (!purchaseDialogOpen.value || !conversationId || !token) return;
    addressListController?.abort();
    const controller = new AbortController();
    addressListController = controller;
    const version = ++addressListVersion;
    const userId = auth.state.user?.id;
    purchaseAddressStatus.value = 'loading';
    try {
      const result = await listUserAddresses(
        token,
        { page: 1, pageSize: 20 },
        controller.signal,
      );
      if (
        disposed ||
        controller.signal.aborted ||
        version !== addressListVersion ||
        userId !== auth.state.user?.id ||
        conversationId !== chat.activeConversationId
      )
        return;
      purchaseAddresses.value = result.items;
      purchaseAddressStatus.value = 'success';
    } catch {
      if (
        !controller.signal.aborted &&
        version === addressListVersion &&
        userId === auth.state.user?.id &&
        conversationId === chat.activeConversationId
      )
        purchaseAddressStatus.value = 'error';
    } finally {
      if (addressListController === controller) addressListController = null;
    }
  }

  watch(
    () =>
      [
        purchaseDialogOpen.value,
        chat.activeConversationId,
        auth.state.user?.id,
      ] as const,
    ([open, conversationId]) => {
      addressListController?.abort();
      addressListVersion += 1;
      purchaseAddresses.value = [];
      purchaseAddressStatus.value = 'idle';
      if (open && conversationId) void loadPurchaseAddresses();
    },
    { immediate: true, flush: 'sync' },
  );

  watch(
    () => auth.state.user?.id,
    () => {
      // 幂等键属于当前账号的待完成操作，账号切换时不可带到新身份下重试。
      pendingAddressSave = null;
      addressSaveController?.abort();
      addressSaveStatus.value = 'idle';
      addressSelectionStates.value = {};
    },
  );

  function sendMessage() {
    if (!canSend.value) return;
    const content = draft.value.trim();
    draft.value = '';
    void chat.sendMessage(content);
  }

  function formResult(form: ChatDynamicForm): ChatDynamicFormResult {
    return {
      formId: form.formId,
      revision: form.revision,
      status: form.status,
      result: form.result ?? null,
      issues: [],
    };
  }

  function publicIssues(error: unknown): ChatDynamicFormResult['issues'] {
    if (
      !(error instanceof ApiError) ||
      !error.details ||
      typeof error.details !== 'object'
    )
      return [];
    const issues = (error.details as { issues?: unknown }).issues;
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((issue) => {
      if (!issue || typeof issue !== 'object') return [];
      const value = issue as Record<string, unknown>;
      return typeof value.code === 'string' && typeof value.message === 'string'
        ? [
            {
              key: typeof value.key === 'string' ? value.key : '',
              code: value.code,
              message: value.message,
            },
          ]
        : [];
    });
  }

  function isCurrentFormRequest(
    sessionKey: string | null,
    conversationId: string,
    formId: string,
    controller: AbortController,
  ): boolean {
    return (
      !disposed &&
      !controller.signal.aborted &&
      sessionKey === chat.activeSessionKey &&
      conversationId === chat.activeConversationId &&
      dynamicFormControllers.get(formId) === controller &&
      auth.state.user?.id !== undefined
    );
  }

  async function submitDynamicFormFromCard(
    form: ChatDynamicForm,
    values: DynamicFormValues,
  ): Promise<void> {
    const token = auth.state.token;
    const conversationId = chat.activeConversationId;
    const sessionKey = chat.activeSessionKey;
    if (!token || !conversationId || dynamicFormSubmitting.value[form.formId])
      return;
    const controller = new AbortController();
    dynamicFormControllers.get(form.formId)?.abort();
    dynamicFormControllers.set(form.formId, controller);
    dynamicFormSubmitting.value = {
      ...dynamicFormSubmitting.value,
      [form.formId]: true,
    };
    dynamicFormErrors.value = { ...dynamicFormErrors.value, [form.formId]: '' };
    try {
      const response = await submitDynamicForm(
        token,
        conversationId,
        form.formId,
        { revision: form.revision, values },
        controller.signal,
      );
      if (
        !isCurrentFormRequest(
          sessionKey,
          conversationId,
          form.formId,
          controller,
        )
      )
        return;
      chat.applyDynamicFormResult(form.formId, formResult(response));
    } catch (error) {
      if (
        !isCurrentFormRequest(
          sessionKey,
          conversationId,
          form.formId,
          controller,
        )
      )
        return;
      if (error instanceof ApiError && error.status === 422) {
        chat.applyDynamicFormResult(form.formId, {
          ...formResult(form),
          issues: publicIssues(error),
        });
      } else if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await getDynamicForm(
            token,
            conversationId,
            form.formId,
            controller.signal,
          );
          if (
            isCurrentFormRequest(
              sessionKey,
              conversationId,
              form.formId,
              controller,
            )
          )
            chat.applyDynamicFormResult(form.formId, formResult(latest));
        } catch {
          dynamicFormErrors.value = {
            ...dynamicFormErrors.value,
            [form.formId]: '表单状态已变化，请刷新后重试',
          };
        }
      } else {
        dynamicFormErrors.value = {
          ...dynamicFormErrors.value,
          [form.formId]:
            error instanceof Error ? error.message : '提交表单失败',
        };
      }
    } finally {
      if (dynamicFormControllers.get(form.formId) === controller) {
        dynamicFormControllers.delete(form.formId);
        dynamicFormSubmitting.value = {
          ...dynamicFormSubmitting.value,
          [form.formId]: false,
        };
      }
    }
  }

  async function cancelDynamicFormFromCard(
    form: ChatDynamicForm,
  ): Promise<void> {
    const token = auth.state.token;
    const conversationId = chat.activeConversationId;
    const sessionKey = chat.activeSessionKey;
    if (!token || !conversationId || dynamicFormSubmitting.value[form.formId])
      return;
    const controller = new AbortController();
    dynamicFormControllers.get(form.formId)?.abort();
    dynamicFormControllers.set(form.formId, controller);
    dynamicFormSubmitting.value = {
      ...dynamicFormSubmitting.value,
      [form.formId]: true,
    };
    try {
      const response = await cancelDynamicForm(
        token,
        conversationId,
        form.formId,
        form.revision,
        controller.signal,
      );
      if (
        isCurrentFormRequest(
          sessionKey,
          conversationId,
          form.formId,
          controller,
        )
      )
        chat.applyDynamicFormResult(form.formId, formResult(response));
    } catch (error) {
      if (
        isCurrentFormRequest(
          sessionKey,
          conversationId,
          form.formId,
          controller,
        )
      ) {
        dynamicFormErrors.value = {
          ...dynamicFormErrors.value,
          [form.formId]:
            error instanceof Error ? error.message : '取消表单失败',
        };
      }
    } finally {
      if (dynamicFormControllers.get(form.formId) === controller) {
        dynamicFormControllers.delete(form.formId);
        dynamicFormSubmitting.value = {
          ...dynamicFormSubmitting.value,
          [form.formId]: false,
        };
      }
    }
  }

  function sendTryOnAction(request: {
    content: string;
    action: ChatTryOnAction;
  }) {
    if (!chat.canSubmit || !request.content.trim()) return;
    void chat.sendMessage(request.content, request.action);
  }

  function loadMoreProducts(messageId: string, resultIndex: number) {
    void chat.loadMoreProducts(messageId, resultIndex);
  }

  function buyProduct(externalId: string): void {
    const current = chat.purchase.draft;
    if (
      current &&
      current.productExternalId !== externalId &&
      !['submitted', 'cancelled', 'expired'].includes(current.status)
    ) {
      replacementProductId.value = externalId;
      replacementDialogOpen.value = true;
      return;
    }
    purchaseDialogOpen.value = true;
    void chat.startPurchaseForProduct(externalId);
  }

  function confirmReplacement(): void {
    const externalId = replacementProductId.value;
    replacementProductId.value = null;
    replacementDialogOpen.value = false;
    if (externalId) {
      purchaseDialogOpen.value = true;
      void chat.startPurchaseForProduct(externalId, true);
    }
  }

  function openPurchaseOrder(orderId: string): void {
    // 订单详情接替购买弹框，避免两层可交互弹框同时争夺焦点。
    purchaseDialogOpen.value = false;
    void orderActions.loadOrder(orderId);
  }

  async function cancelCandidateOrder(orderId: string): Promise<void> {
    const sessionKey = chat.activeSessionKey;
    if (!sessionKey || candidateCancellationOrderId.value) return;
    candidateCancellationSessionKey.value = sessionKey;
    candidateCancellationOrderId.value = orderId;
    const opened = await orderActions.requestCancelForCandidate(
      orderId,
      () =>
        !disposed &&
        chat.activeSessionKey === sessionKey &&
        candidateCancellationOrderId.value === orderId,
    );
    if (
      !opened &&
      candidateCancellationSessionKey.value === sessionKey &&
      candidateCancellationOrderId.value === orderId
    ) {
      candidateCancellationSessionKey.value = null;
      candidateCancellationOrderId.value = null;
    }
  }

  function updateOrderActionDialog(open: boolean): void {
    orderActions.actionDialogOpen.value = open;
    if (
      !open &&
      !candidateConfirmationInFlight &&
      candidateCancellationOrderId.value !== null
    ) {
      candidateCancellationSessionKey.value = null;
      candidateCancellationOrderId.value = null;
    }
  }

  async function confirmOrderAction(): Promise<void> {
    const sessionKey = candidateCancellationSessionKey.value;
    const orderId = candidateCancellationOrderId.value;
    candidateConfirmationInFlight = orderId !== null;
    try {
      const result = await orderActions.confirmAction(
        () =>
          sessionKey === null ||
          (!disposed &&
            chat.activeSessionKey === sessionKey &&
            candidateCancellationOrderId.value === orderId),
        sessionKey !== null && orderId !== null,
      );
      if (
        sessionKey &&
        orderId &&
        !disposed &&
        chat.activeSessionKey === sessionKey &&
        candidateCancellationOrderId.value === orderId &&
        result?.id === orderId &&
        result.status === 'closed' &&
        result.closeReason === 'user_cancelled'
      ) {
        chat.markOrderCancellationComplete(sessionKey, orderId);
      }
    } finally {
      candidateConfirmationInFlight = false;
      if (candidateCancellationOrderId.value === orderId) {
        candidateCancellationSessionKey.value = null;
        candidateCancellationOrderId.value = null;
      }
    }
  }

  function updatePurchase(
    payload: Omit<PatchPurchasePayload, 'expectedVersion'>,
  ): void {
    void runPurchaseAction(
      () => chat.updatePurchaseDraft(payload),
      '购买信息已保存',
    );
  }

  function addressSelectionKey(draftId: string, draftVersion: number): string {
    return `${draftId}:${draftVersion}`;
  }

  function addressSelectionStatus(
    draftId: string,
    draftVersion: number,
  ): ChatAddressSelectionActionStatus {
    return (
      addressSelectionStates.value[addressSelectionKey(draftId, draftVersion)]
        ?.status ?? 'idle'
    );
  }

  function addressSelectionError(
    draftId: string,
    draftVersion: number,
  ): string {
    return (
      addressSelectionStates.value[addressSelectionKey(draftId, draftVersion)]
        ?.error ?? ''
    );
  }

  async function submitPurchaseAddressSelection(
    request: ChatAddressSelectionRequest,
    showToast = false,
  ): Promise<void> {
    const current = chat.purchase.draft;
    if (
      !current ||
      request.conversationId !== chat.activeConversationId ||
      current.id !== request.draftId ||
      current.version !== request.draftVersion ||
      chat.isSending ||
      !['collecting', 'ready'].includes(current.status)
    )
      return;
    const key = addressSelectionKey(request.draftId, request.draftVersion);
    if (
      addressSelectionStatus(request.draftId, request.draftVersion) ===
      'submitting'
    )
      return;
    const sessionKey = chat.activeSessionKey;
    const userId = auth.state.user?.id;
    const { conversationId, draftVersion, ...payload } = request;
    addressSelectionStates.value = {
      ...addressSelectionStates.value,
      [key]: { status: 'submitting', error: '' },
    };
    const result = await chat.selectPurchaseAddressFromCard({
      ...payload,
      expectedVersion: draftVersion,
    });
    if (
      disposed ||
      sessionKey !== chat.activeSessionKey ||
      userId !== auth.state.user?.id ||
      conversationId !== chat.activeConversationId
    )
      return;
    addressSelectionStates.value = {
      ...addressSelectionStates.value,
      [key]: {
        status: result,
        error:
          result === 'error' ? '地址选择失败，请重新检查草稿状态后重试。' : '',
      },
    };
    if (showToast && result === 'success')
      toast.success('收货地址已用于本次购买');
    if (showToast && result === 'conflict')
      toast.error('购买草稿已变化，请检查最新状态后重试');
    if (showToast && result === 'unknown')
      toast.error('地址提交结果待核实，已刷新购买草稿');
    if (result === 'error' || result === 'stale')
      await chat.loadPurchaseDraft(conversationId);
  }

  function refreshPurchaseDraftForCard(conversationId: string): void {
    if (conversationId !== chat.activeConversationId) return;
    void chat.loadPurchaseDraft(conversationId);
  }

  function selectPurchaseAddress(addressId: string): void {
    const selected = purchaseAddresses.value.find(
      (address) => address.id === addressId,
    );
    const current = chat.purchase.draft;
    const conversationId = chat.activeConversationId;
    if (!selected || !current || !conversationId) return;
    void submitPurchaseAddressSelection(
      {
        draftId: current.id,
        draftVersion: current.version,
        addressId: selected.id,
        conversationId,
      },
      true,
    );
  }

  async function saveDraftAddress(): Promise<void> {
    const token = auth.state.token;
    const current = chat.purchase.draft;
    const recipient = current?.recipient;
    if (
      !token ||
      !current ||
      !recipient?.name ||
      !recipient.phone ||
      !recipient.address ||
      addressSaveStatus.value === 'submitting'
    )
      return;
    const sessionKey = chat.activeSessionKey;
    const userId = auth.state.user?.id;
    const payload = {
      recipientName: recipient.name,
      phone: recipient.phone,
      address: recipient.address,
      label: null,
      isDefault: false,
    };
    const fingerprint = JSON.stringify(payload);
    const requestKey =
      pendingAddressSave?.fingerprint === fingerprint
        ? pendingAddressSave.requestKey
        : crypto.randomUUID();
    pendingAddressSave = { fingerprint, requestKey };
    const controller = new AbortController();
    addressSaveController?.abort();
    addressSaveController = controller;
    addressSaveStatus.value = 'submitting';
    try {
      await createUserAddress(
        token,
        { ...payload, requestKey },
        controller.signal,
      );
      if (
        disposed ||
        controller.signal.aborted ||
        sessionKey !== chat.activeSessionKey ||
        userId !== auth.state.user?.id
      )
        return;
      pendingAddressSave = null;
      addressSaveStatus.value = 'idle';
      toast.success('收货地址已保存到地址簿');
    } catch (error) {
      if (
        disposed ||
        controller.signal.aborted ||
        sessionKey !== chat.activeSessionKey ||
        userId !== auth.state.user?.id
      )
        return;
      addressSaveStatus.value =
        error instanceof ApiError && error.status === 0 ? 'unknown' : 'error';
      toast.error(
        addressSaveStatus.value === 'unknown'
          ? '保存结果尚未确认，请使用重试按钮核实'
          : error instanceof Error
            ? error.message
            : '保存收货地址失败',
      );
    } finally {
      if (addressSaveController === controller) addressSaveController = null;
    }
  }

  async function runPurchaseAction(
    action: () => Promise<boolean>,
    message: string,
  ) {
    const sessionKey = chat.activeSessionKey;
    const userId = auth.state.user?.id;
    const succeeded = await action();
    // 操作结束后仍在原账号与会话才显示成功，后台结果继续由 Store 维护。
    if (
      !disposed &&
      succeeded &&
      sessionKey === chat.activeSessionKey &&
      userId === auth.state.user?.id
    ) {
      toast.success(message);
    }
  }

  function selectConversation(id: string) {
    draft.value = '';
    return chat.selectConversation(id, id === chat.activeConversationId);
  }

  function startNewConversation() {
    draft.value = '';
    chat.startNewConversation();
  }

  async function removeConversation(id: string): Promise<void> {
    const userId = auth.state.user?.id;
    const removed = await chat.removeConversation(id);
    if (!disposed && removed && userId === auth.state.user?.id) {
      toast.success('会话已删除');
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      sendMessage();
    }
  }

  onMounted(() => {
    chat.setChatPageVisible(true);
    void chat.loadConversations();
  });
  onBeforeUnmount(() => {
    disposed = true;
    addressListController?.abort();
    addressSaveController?.abort();
    addressListVersion += 1;
    // 页面卸载只解绑展示，后台生成由 Store 继续接收并维护所属会话。
    chat.setChatPageVisible(false);
  });

  return {
    ...storeToRefs(chat),
    draft,
    replacementProductId,
    replacementDialogOpen,
    purchaseDialogOpen,
    purchaseAddresses,
    purchaseAddressStatus,
    addressSelectionStatus,
    addressSelectionError,
    addressSaveStatus,
    dynamicFormSubmitting: (formId: string) =>
      Boolean(dynamicFormSubmitting.value[formId]),
    dynamicFormError: (formId: string) => dynamicFormErrors.value[formId] ?? '',
    submitDynamicForm: submitDynamicFormFromCard,
    cancelDynamicForm: cancelDynamicFormFromCard,
    retryPurchaseAddresses: loadPurchaseAddresses,
    canSend,
    handleKeydown,
    sendMessage,
    sendTryOnAction,
    loadMoreProducts,
    buyProduct,
    confirmReplacement,
    openPurchaseOrder,
    cancelCandidateOrder,
    updateOrderActionDialog,
    confirmOrderAction,
    updatePurchase,
    selectPurchaseAddress,
    submitPurchaseAddressSelection,
    refreshPurchaseDraftForCard,
    saveDraftAddress,
    discardPurchase: () =>
      runPurchaseAction(chat.discardPurchase, '已放弃本次购买'),
    confirmPurchaseOrder: () =>
      runPurchaseAction(chat.confirmPurchaseOrder, '订单已创建'),
    retryPurchase: () => chat.loadPurchaseDraft(chat.activeConversationId),
    selectConversation,
    startNewConversation,
    loadConversations: chat.loadConversations,
    loadEarlierMessages: chat.loadEarlierMessages,
    loadMoreConversations: chat.loadMoreConversations,
    refreshUncertainTurn: chat.refreshUncertainTurn,
    removeConversation,
    stopGeneration: chat.stopGeneration,
    ...orderActions,
  };
}
