import { computed, onBeforeUnmount, ref } from 'vue';
import {
  conversations,
  createConversationMessages,
  formatChatTime,
} from './mock-data';
import type { ChatMessage } from '@/api/types/chat';

export function useChatPage() {
  const activeConversationId = ref(1);
  const draft = ref('');
  const isSending = ref(false);
  const messages = ref<ChatMessage[]>(createConversationMessages(1));
  const nextMessageId = ref(4);
  let responseTimer: number | undefined;

  const activeConversation = computed(() =>
    conversations.find(
      (conversation) => conversation.id === activeConversationId.value,
    ),
  );
  const canSend = computed(
    () => draft.value.trim().length > 0 && !isSending.value,
  );

  function startNewConversation() {
    activeConversationId.value = 0;
    messages.value = createConversationMessages(0);
    draft.value = '';
  }

  function selectConversation(conversationId: number) {
    activeConversationId.value = conversationId;
    messages.value = createConversationMessages(conversationId);
    draft.value = '';
  }

  async function sendMessage() {
    const content = draft.value.trim();
    if (!content || isSending.value) return;

    messages.value.push({
      id: nextMessageId.value++,
      role: 'user',
      content,
      time: formatChatTime(),
    });
    draft.value = '';
    isSending.value = true;

    // 当前先保留本地响应适配器，接入后端时只替换该异步边界。
    responseTimer = window.setTimeout(() => {
      messages.value.push({
        id: nextMessageId.value++,
        role: 'assistant',
        content:
          '收到。你可以继续告诉我预算、喜欢的颜色，或者分享一件已有单品，我会把建议调整得更具体。',
        time: formatChatTime(),
      });
      isSending.value = false;
      responseTimer = undefined;
    }, 500);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  onBeforeUnmount(() => {
    if (responseTimer !== undefined) {
      window.clearTimeout(responseTimer);
    }
  });

  return {
    activeConversation,
    activeConversationId,
    canSend,
    conversations,
    draft,
    handleKeydown,
    isSending,
    messages,
    selectConversation,
    sendMessage,
    startNewConversation,
  };
}
