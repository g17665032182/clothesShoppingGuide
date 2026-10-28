import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ApiError } from '@/api';
import {
  deleteConversation as deleteConversationRequest,
  getConversation,
  listConversations,
  streamChat,
} from '@/api/modules/chat';
import type {
  ChatApiConversation,
  ChatApiMessage,
  ChatMessage,
  ChatStreamEvent,
  Conversation,
} from '@/api/types/chat';
import { auth } from '@/lib/auth';

type ChatPageStatus =
  'idle' | 'loading' | 'streaming' | 'success' | 'error' | 'unknown';
type ConversationListStatus = 'loading' | 'success' | 'empty' | 'error';

function formatChatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatElapsedTime(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? `用时 ${minutes}分 ${remainingSeconds}秒`
    : `用时 ${remainingSeconds}秒`;
}

async function waitForMessagePaint(): Promise<void> {
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function toConversation(item: ChatApiConversation): Conversation {
  return {
    id: item.id,
    title: item.title,
    preview: '',
    updatedAt: formatChatTime(new Date(item.updatedAt)),
  };
}

function toMessage(message: ChatApiMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

export function useChatPage() {
  const activeConversationId = ref<string | null>(null);
  const conversations = ref<Conversation[]>([]);
  const conversationListStatus = ref<ConversationListStatus>('loading');
  const conversationListError = ref('');
  const isLoadingMoreConversations = ref(false);
  const deletingConversationId = ref<string | null>(null);
  const hasMoreConversations = ref(false);
  const conversationPage = ref(1);
  const draft = ref('');
  const messages = ref<ChatMessage[]>([]);
  const status = ref<ChatPageStatus>('idle');
  const errorMessage = ref('');
  const streamDuration = ref<string | null>(null);
  let abortController: AbortController | null = null;
  let requestVersion = 0;
  let uncertainTurn: { conversationId: string; userText: string } | null = null;
  let streamStartedAt: number | null = null;
  let streamTimer: number | undefined;
  let streamingAssistantMessageId: string | null = null;
  let conversationListRequestVersion = 0;

  const activeConversation = computed(() =>
    activeConversationId.value
      ? conversations.value.find(
          (conversation) => conversation.id === activeConversationId.value,
        )
      : undefined,
  );
  const hasActiveConversation = computed(
    () => activeConversationId.value !== null || messages.value.length > 0,
  );
  const isSending = computed(() => status.value === 'streaming');
  const canSend = computed(
    () =>
      draft.value.trim().length > 0 &&
      !isSending.value &&
      status.value !== 'loading' &&
      status.value !== 'unknown',
  );
  const canDeleteConversations = computed(
    () =>
      !isSending.value &&
      status.value !== 'loading' &&
      status.value !== 'unknown' &&
      deletingConversationId.value === null,
  );

  // 将生成耗时同步到当前助手消息，并在流结束或取消后保留最终值。
  function updateStreamDuration() {
    if (streamStartedAt === null) return;
    const duration = formatElapsedTime(streamStartedAt);
    streamDuration.value = duration;
    if (!streamingAssistantMessageId) return;
    const message = messages.value.find(
      (item) => item.id === streamingAssistantMessageId,
    );
    if (message?.role === 'assistant') {
      message.duration = duration;
    }
  }

  function finishStreamDuration(): string | null {
    if (streamStartedAt === null) return null;
    const duration = formatElapsedTime(streamStartedAt);
    streamDuration.value = duration;
    const message = messages.value.find(
      (item) => item.id === streamingAssistantMessageId,
    );
    if (message?.role === 'assistant') {
      message.duration = duration;
    }
    if (streamTimer !== undefined) {
      window.clearInterval(streamTimer);
      streamTimer = undefined;
    }
    streamStartedAt = null;
    return duration;
  }

  function cancelCurrentRequest() {
    abortController?.abort();
    abortController = null;
    finishStreamDuration();
  }

  function upsertConversation(conversation: Conversation) {
    conversationListStatus.value = 'success';
    const index = conversations.value.findIndex(
      (item) => item.id === conversation.id,
    );
    if (index === -1) {
      conversations.value.unshift(conversation);
      return;
    }
    conversations.value[index] = {
      ...conversations.value[index],
      ...conversation,
    };
  }

  async function loadConversations(page = 1, append = false) {
    if (!auth.state.token) return;
    if (append) {
      if (isLoadingMoreConversations.value || !hasMoreConversations.value)
        return;
      isLoadingMoreConversations.value = true;
    } else {
      isLoadingMoreConversations.value = false;
      conversationListStatus.value = 'loading';
    }
    const version = ++conversationListRequestVersion;
    conversationListError.value = '';
    try {
      const response = await listConversations(auth.state.token, page);
      if (version !== conversationListRequestVersion) return;
      const received = response.items.map(toConversation);
      if (append) {
        const existingIds = new Set(conversations.value.map((item) => item.id));
        conversations.value.push(
          ...received.filter((item) => !existingIds.has(item.id)),
        );
      } else {
        conversations.value = received;
      }
      conversationPage.value = page;
      hasMoreConversations.value = response.page < response.totalPages;
      conversationListStatus.value =
        conversations.value.length > 0 ? 'success' : 'empty';
    } catch (error) {
      if (version !== conversationListRequestVersion) return;
      conversationListStatus.value = 'error';
      conversationListError.value =
        error instanceof Error ? error.message : '会话列表加载失败';
    } finally {
      if (version === conversationListRequestVersion) {
        isLoadingMoreConversations.value = false;
      }
    }
  }

  function loadMoreConversations() {
    if (!hasMoreConversations.value || isLoadingMoreConversations.value) return;
    void loadConversations(conversationPage.value + 1, true);
  }

  async function removeConversation(conversationId: string) {
    const token = auth.state.token;
    if (
      !token ||
      deletingConversationId.value ||
      isSending.value ||
      status.value === 'loading' ||
      status.value === 'unknown'
    ) {
      return;
    }

    const conversation = conversations.value.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) return;

    deletingConversationId.value = conversationId;
    conversationListError.value = '';
    try {
      await deleteConversationRequest(token, conversationId);
      conversations.value = conversations.value.filter(
        (item) => item.id !== conversationId,
      );
      if (activeConversationId.value === conversationId) {
        startNewConversation();
      }
      await loadConversations();
    } catch (error) {
      conversationListError.value =
        error instanceof Error ? error.message : '删除会话失败';
    } finally {
      deletingConversationId.value = null;
    }
  }

  function startNewConversation() {
    requestVersion += 1;
    cancelCurrentRequest();
    uncertainTurn = null;
    activeConversationId.value = null;
    messages.value = [];
    draft.value = '';
    errorMessage.value = '';
    status.value = 'idle';
  }

  async function selectConversation(conversationId: string) {
    if (!auth.state.token) return;
    requestVersion += 1;
    const version = requestVersion;
    cancelCurrentRequest();
    uncertainTurn = null;
    activeConversationId.value = conversationId;
    messages.value = [];
    draft.value = '';
    errorMessage.value = '';
    status.value = 'loading';
    try {
      const response = await getConversation(auth.state.token, conversationId);
      if (version !== requestVersion) return;
      upsertConversation(toConversation(response));
      messages.value = response.messages.items.map(toMessage);
      status.value = 'success';
    } catch (error) {
      if (version !== requestVersion) return;
      status.value = 'error';
      errorMessage.value =
        error instanceof Error ? error.message : '会话加载失败';
    }
  }

  function applyStreamEvent(
    event: ChatStreamEvent,
    assistantMessageId: { value: string | null },
  ) {
    if (event.type === 'start') {
      activeConversationId.value = event.conversationId;
      upsertConversation({
        id: event.conversationId,
        title: event.title,
        preview: '',
        updatedAt: '刚刚',
      });
      return;
    }
    if (event.type === 'delta') {
      if (!assistantMessageId.value) {
        assistantMessageId.value = `stream-${requestVersion}`;
        messages.value.push({
          id: assistantMessageId.value,
          role: 'assistant',
          content: event.content,
          createdAt: new Date().toISOString(),
          ...(streamStartedAt !== null
            ? { duration: formatElapsedTime(streamStartedAt) }
            : {}),
        });
      } else {
        const message = messages.value.find(
          (item) => item.id === assistantMessageId.value,
        );
        if (message) message.content += event.content;
      }
      return;
    }
    if (event.type === 'error') {
      errorMessage.value = event.message;
    }
  }

  async function refreshUncertainTurn() {
    if (!auth.state.token || !uncertainTurn) return;
    const { conversationId, userText } = uncertainTurn;
    status.value = 'loading';
    try {
      const detail = await getConversation(auth.state.token, conversationId);
      activeConversationId.value = conversationId;
      upsertConversation(toConversation(detail));
      messages.value = detail.messages.items.map(toMessage);
      status.value = 'success';
      errorMessage.value = '已从历史记录核实本轮状态';
      uncertainTurn = null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        messages.value = messages.value.filter(
          (message) => !message.id.startsWith('pending-'),
        );
        draft.value = userText;
        status.value = 'error';
        errorMessage.value = '历史记录中没有本轮内容，可以重新发送';
        uncertainTurn = null;
        return;
      }
      status.value = 'unknown';
      errorMessage.value = '暂时无法核实保存状态，请稍后重试刷新';
    }
  }

  async function sendMessage() {
    const content = draft.value.trim();
    const token = auth.state.token;
    if (!content || !token || isSending.value || status.value === 'unknown') {
      return;
    }

    requestVersion += 1;
    const version = requestVersion;
    cancelCurrentRequest();
    uncertainTurn = null;
    abortController = new AbortController();
    const controller = abortController;
    const assistantMessageId = { value: null as string | null };
    streamStartedAt = Date.now();
    streamDuration.value = formatElapsedTime(streamStartedAt);
    streamingAssistantMessageId = `stream-${version}`;
    streamTimer = window.setInterval(updateStreamDuration, 1000);
    messages.value.push({
      id: `pending-user-${version}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    });
    draft.value = '';
    errorMessage.value = '';
    status.value = 'streaming';
    let receivedStart = false;
    let receivedDone = false;

    try {
      const request = {
        messages: [{ role: 'user' as const, content }],
        ...(activeConversationId.value
          ? { conversationId: activeConversationId.value }
          : {}),
      };
      for await (const event of streamChat(token, request, controller.signal)) {
        if (version !== requestVersion) return;
        if (event.type === 'start') {
          receivedStart = true;
        }
        applyStreamEvent(event, assistantMessageId);
        if (event.type === 'error') {
          status.value = 'error';
          return;
        }
        if (event.type === 'delta') {
          await waitForMessagePaint();
        }
        if (event.type === 'done') {
          receivedDone = true;
          const duration = finishStreamDuration();
          activeConversationId.value = event.conversationId;
          upsertConversation({
            id: event.conversationId,
            title: event.title,
            preview: content,
            updatedAt: '刚刚',
          });
          const detail = await getConversation(token, event.conversationId);
          if (version !== requestVersion) return;
          const lastAssistantIndex = detail.messages.items.reduce(
            (index, message, currentIndex) =>
              message.role === 'assistant' ? currentIndex : index,
            -1,
          );
          messages.value = detail.messages.items.map((message, index) => ({
            ...toMessage(message),
            ...(index === lastAssistantIndex && duration ? { duration } : {}),
          }));
          status.value = 'success';
        }
      }
    } catch (error) {
      if (version !== requestVersion || controller.signal.aborted) return;
      if (receivedDone) {
        status.value = 'success';
        errorMessage.value = '回复已保存，但历史记录刷新失败';
      } else if (receivedStart && activeConversationId.value) {
        uncertainTurn = {
          conversationId: activeConversationId.value,
          userText: content,
        };
        status.value = 'unknown';
        errorMessage.value =
          '连接中断，无法确认本轮是否已保存。请刷新核实后再继续';
      } else {
        status.value = 'error';
        errorMessage.value =
          error instanceof Error ? error.message : '聊天请求失败';
      }
    } finally {
      finishStreamDuration();
      if (version === requestVersion) {
        abortController = null;
        if (status.value === 'streaming') {
          status.value = 'error';
          errorMessage.value = '聊天流未正常结束，请刷新会话确认状态';
        }
      }
    }
  }

  function stopGeneration() {
    cancelCurrentRequest();
    if (status.value === 'streaming') {
      status.value = 'error';
      errorMessage.value = '已停止生成；请刷新会话确认是否已保存';
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  onMounted(() => {
    void loadConversations();
  });

  onBeforeUnmount(() => {
    requestVersion += 1;
    cancelCurrentRequest();
  });

  return {
    activeConversation,
    activeConversationId,
    canSend,
    canDeleteConversations,
    conversations,
    conversationListError,
    conversationListStatus,
    draft,
    errorMessage,
    hasMoreConversations,
    handleKeydown,
    hasActiveConversation,
    isLoadingMoreConversations,
    isSending,
    messages,
    deletingConversationId,
    loadConversations,
    loadMoreConversations,
    removeConversation,
    refreshUncertainTurn,
    selectConversation,
    sendMessage,
    startNewConversation,
    status,
    streamDuration,
    stopGeneration,
  };
}
