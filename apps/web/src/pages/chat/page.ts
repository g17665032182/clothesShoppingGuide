import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useChatStore } from '@/stores/chat';

export function useChatPage() {
  const chat = useChatStore();
  const draft = ref('');
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
    canSend,
    handleKeydown,
    sendMessage,
    selectConversation,
    startNewConversation,
    loadConversations: chat.loadConversations,
    loadEarlierMessages: chat.loadEarlierMessages,
    loadMoreConversations: chat.loadMoreConversations,
    refreshUncertainTurn: chat.refreshUncertainTurn,
    removeConversation: chat.removeConversation,
    stopGeneration: chat.stopGeneration,
  };
}
