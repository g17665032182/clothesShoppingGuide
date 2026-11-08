import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useChatStore } from '@/stores/chat';
import type { PatchPurchasePayload } from '@/api/types/chat-purchase';
import { useChatOrder } from '@/components/shared/orders/useChatOrder';

export function useChatPage() {
  const chat = useChatStore();
  const orderActions = useChatOrder();
  const draft = ref('');
  const replacementProductId = ref<string | null>(null);
  const replacementDialogOpen = ref(false);
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
    void chat.startPurchaseForProduct(externalId);
  }

  function confirmReplacement(): void {
    const externalId = replacementProductId.value;
    replacementProductId.value = null;
    replacementDialogOpen.value = false;
    if (externalId) void chat.startPurchaseForProduct(externalId, true);
  }

  function updatePurchase(
    payload: Omit<PatchPurchasePayload, 'expectedVersion'>,
  ): void {
    void chat.updatePurchaseDraft(payload);
  }

  function selectConversation(id: string) {
    draft.value = '';
    return chat.selectConversation(id, id === chat.activeConversationId);
  }

  function startNewConversation() {
    draft.value = '';
    chat.startNewConversation();
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
    // 页面卸载只解绑展示，后台生成由 Store 继续接收并维护所属会话。
    chat.setChatPageVisible(false);
  });

  return {
    ...storeToRefs(chat),
    draft,
    replacementProductId,
    replacementDialogOpen,
    canSend,
    handleKeydown,
    sendMessage,
    loadMoreProducts,
    buyProduct,
    confirmReplacement,
    updatePurchase,
    discardPurchase: chat.discardPurchase,
    confirmPurchaseOrder: chat.confirmPurchaseOrder,
    retryPurchase: () => chat.loadPurchaseDraft(chat.activeConversationId),
    selectConversation,
    startNewConversation,
    loadConversations: chat.loadConversations,
    loadEarlierMessages: chat.loadEarlierMessages,
    loadMoreConversations: chat.loadMoreConversations,
    refreshUncertainTurn: chat.refreshUncertainTurn,
    removeConversation: chat.removeConversation,
    stopGeneration: chat.stopGeneration,
    ...orderActions,
  };
}
