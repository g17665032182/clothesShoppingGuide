import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { useErrorToast } from '@/composables/use-error-toast';
import { auth } from '@/lib/auth';
import { useChatStore } from '@/stores/chat';
import type { PatchPurchasePayload } from '@/api/types/chat-purchase';
import { useChatOrder } from '@/components/shared/orders/useChatOrder';

export function useChatPage() {
  const chat = useChatStore();
  const orderActions = useChatOrder();
  const draft = ref('');
  const replacementProductId = ref<string | null>(null);
  const replacementDialogOpen = ref(false);
  const purchaseDialogOpen = ref(false);
  let disposed = false;
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
      replacementDialogOpen.value = false;
      replacementProductId.value = null;
    },
    { flush: 'sync' },
  );

  function sendMessage() {
    if (!canSend.value) return;
    const content = draft.value.trim();
    draft.value = '';
    void chat.sendMessage(content);
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

  function updatePurchase(
    payload: Omit<PatchPurchasePayload, 'expectedVersion'>,
  ): void {
    void runPurchaseAction(
      () => chat.updatePurchaseDraft(payload),
      '购买信息已保存',
    );
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
    // 页面卸载只解绑展示，后台生成由 Store 继续接收并维护所属会话。
    chat.setChatPageVisible(false);
  });

  return {
    ...storeToRefs(chat),
    draft,
    replacementProductId,
    replacementDialogOpen,
    purchaseDialogOpen,
    canSend,
    handleKeydown,
    sendMessage,
    loadMoreProducts,
    buyProduct,
    confirmReplacement,
    openPurchaseOrder,
    updatePurchase,
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
