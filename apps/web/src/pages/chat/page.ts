import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue';
import { ApiError } from '@/api';
import {
  deleteConversation as deleteConversationRequest,
  getConversation,
  listConversations,
  streamChat,
} from '@/api/modules/chat';
import type {
  ChatApiConversation,
  ChatMessage,
  Conversation,
} from '@/api/types/chat';
import { auth } from '@/lib/auth';
import {
  applyTurnEvent,
  createPendingMessage,
  finishTurn,
  toChatMessage,
} from './chat-turn';

type ChatPageStatus =
  'idle' | 'loading' | 'streaming' | 'success' | 'empty' | 'error' | 'unknown';
type ConversationListStatus = 'loading' | 'success' | 'empty' | 'error';
type PendingTurn = {
  conversationId: string | null;
  assistant: ChatMessage;
  user: ChatMessage;
  knownMessageIds: Set<string>;
};

function toConversation(item: ChatApiConversation): Conversation {
  return {
    id: item.id,
    title: item.title,
    preview: '',
    updatedAt: new Date(item.updatedAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }),
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
  // 工具参数是递归 JSON，浅层引用避免 Vue 深解包，更新时替换消息及数组。
  const messages = shallowRef<ChatMessage[]>([]);
  const status = ref<ChatPageStatus>('idle');
  const errorMessage = ref('');
  const streamDuration = ref<string | null>(null);
  const historyError = ref('');
  const firstLoadedPage = ref(1);
  const isLoadingEarlierMessages = ref(false);
  const uncertainTurns = new Map<string, PendingTurn>();
  let currentTurn: PendingTurn | null = null;
  let abortController: AbortController | null = null;
  let historyController: AbortController | null = null;
  let listController: AbortController | null = null;
  let requestVersion = 0;
  let listVersion = 0;
  let pendingListUpdates: Set<string> | null = null;
  let streamTimer: number | undefined;
  let streamStartedAt: number | null = null;
  let disposed = false;

  const activeConversation = computed(() =>
    conversations.value.find((item) => item.id === activeConversationId.value),
  );
  const hasActiveConversation = computed(
    () => activeConversationId.value !== null || messages.value.length > 0,
  );
  const isSending = computed(() => status.value === 'streaming');
  const canSend = computed(
    () =>
      draft.value.trim().length > 0 &&
      draft.value.length <= 2000 &&
      !['streaming', 'loading', 'unknown'].includes(status.value),
  );
  const canDeleteConversations = computed(
    () =>
      !['streaming', 'loading', 'unknown'].includes(status.value) &&
      deletingConversationId.value === null,
  );
  const hasEarlierMessages = computed(() => firstLoadedPage.value > 1);
  const context = computed(
    () =>
      [...messages.value]
        .reverse()
        .find((item) => item.role === 'assistant' && item.status === 'saved')
        ?.context ?? null,
  );
  const contextIsPrevious = computed(() => isSending.value);

  function publishMessages() {
    if (!currentTurn) return;
    // 子组件按 Props 身份更新，不能仅触发浅引用后继续复用已修改的对象。
    currentTurn.assistant = {
      ...currentTurn.assistant,
      activities: [...currentTurn.assistant.activities],
      sources: [...currentTurn.assistant.sources],
    };
    currentTurn.user = { ...currentTurn.user };
    const turn = currentTurn;
    messages.value = messages.value.map((item) =>
      item.id === turn.assistant.id
        ? turn.assistant
        : item.id === turn.user.id
          ? turn.user
          : item,
    );
  }

  function upsertConversation(conversation: Conversation) {
    pendingListUpdates?.add(conversation.id);
    const index = conversations.value.findIndex(
      (item) => item.id === conversation.id,
    );
    if (index < 0) conversations.value.unshift(conversation);
    else
      conversations.value[index] = {
        ...conversations.value[index],
        ...conversation,
      };
    conversationListStatus.value = 'success';
  }

  function updateDuration() {
    if (streamStartedAt === null) return;
    const seconds = Math.floor((Date.now() - streamStartedAt) / 1000);
    const duration =
      seconds >= 60
        ? `用时 ${Math.floor(seconds / 60)}分 ${seconds % 60}秒`
        : `用时 ${seconds}秒`;
    streamDuration.value = duration;
    if (currentTurn) currentTurn.assistant.duration = duration;
    publishMessages();
  }

  function finishDuration() {
    updateDuration();
    if (streamTimer !== undefined) window.clearInterval(streamTimer);
    streamTimer = undefined;
    streamStartedAt = null;
  }

  function markUncertain() {
    if (!currentTurn) return;
    finishTurn(currentTurn.assistant, 'uncertain');
    if (currentTurn.conversationId)
      uncertainTurns.set(currentTurn.conversationId, currentTurn);
    publishMessages();
    status.value = currentTurn.conversationId ? 'unknown' : 'error';
    errorMessage.value = currentTurn.conversationId
      ? '生成已中断，尚无法确认本轮是否保存。请刷新核实后再继续'
      : '生成已中断，尚未取得会话编号，无法核实保存状态';
  }

  function cancelCurrentRequest() {
    if (isSending.value) markUncertain();
    abortController?.abort();
    abortController = null;
    historyController?.abort();
    historyController = null;
    finishDuration();
    isLoadingEarlierMessages.value = false;
  }

  async function loadConversations(page = 1, append = false) {
    const token = auth.state.token;
    if (
      !token ||
      (append &&
        (isLoadingMoreConversations.value || !hasMoreConversations.value))
    )
      return;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    const version = ++listVersion;
    const updates = new Set<string>();
    pendingListUpdates = updates;
    isLoadingMoreConversations.value = append;
    if (!append) conversationListStatus.value = 'loading';
    conversationListError.value = '';
    try {
      const response = await listConversations(token, page, controller.signal);
      if (disposed || version !== listVersion) return;
      const received = response.items.map(toConversation);
      const existing = new Set(conversations.value.map((item) => item.id));
      const updated = conversations.value.filter((item) =>
        updates.has(item.id),
      );
      const updatedIds = new Set(updated.map((item) => item.id));
      conversations.value = append
        ? [
            ...conversations.value,
            ...received.filter((item) => !existing.has(item.id)),
          ]
        : [...updated, ...received.filter((item) => !updatedIds.has(item.id))];
      conversationPage.value = page;
      hasMoreConversations.value = response.page < response.totalPages;
      conversationListStatus.value = conversations.value.length
        ? 'success'
        : 'empty';
    } catch (error) {
      if (disposed || version !== listVersion || controller.signal.aborted)
        return;
      conversationListStatus.value = 'error';
      conversationListError.value =
        error instanceof Error ? error.message : '会话列表加载失败';
    } finally {
      if (!disposed && version === listVersion)
        isLoadingMoreConversations.value = false;
      if (version === listVersion) pendingListUpdates = null;
    }
  }

  function loadMoreConversations() {
    void loadConversations(conversationPage.value + 1, true);
  }

  async function removeConversation(id: string) {
    const token = auth.state.token;
    if (!token || !canDeleteConversations.value) return;
    deletingConversationId.value = id;
    try {
      await deleteConversationRequest(token, id);
      if (disposed) return;
      uncertainTurns.delete(id);
      conversations.value = conversations.value.filter(
        (item) => item.id !== id,
      );
      if (activeConversationId.value === id) startNewConversation();
      await loadConversations();
    } catch (error) {
      if (!disposed)
        conversationListError.value =
          error instanceof Error ? error.message : '删除会话失败';
    } finally {
      if (!disposed) deletingConversationId.value = null;
    }
  }

  function startNewConversation() {
    cancelCurrentRequest();
    requestVersion += 1;
    currentTurn = null;
    activeConversationId.value = null;
    messages.value = [];
    draft.value = '';
    errorMessage.value = '';
    historyError.value = '';
    firstLoadedPage.value = 1;
    status.value = 'idle';
  }

  async function latestDetail(token: string, id: string, signal: AbortSignal) {
    let detail = await getConversation(token, id, 1, signal);
    let page = Math.max(1, detail.messages.totalPages);
    if (page > 1) detail = await getConversation(token, id, page, signal);
    // 读取期间若新一轮提交跨页，仅追赶一次，不进行后台轮询。
    if (detail.messages.totalPages > page) {
      page = detail.messages.totalPages;
      detail = await getConversation(token, id, page, signal);
    }
    let items = detail.messages.items;
    if (page > 1 && items.length < 2) {
      const previous = await getConversation(token, id, page - 1, signal);
      items = [...previous.messages.items, ...items];
      page -= 1;
    }
    return { detail, items, page };
  }

  function reconcileUncertain(
    turn: PendingTurn,
    saved: ChatMessage[],
  ): boolean {
    const activityIds = new Set(
      turn.assistant.activities.map((item) => item.id),
    );
    // 文本相同不能证明是同一轮；仅已持久化的新助手消息及稳定活动 ID 可佐证。
    return (
      activityIds.size > 0 &&
      saved.some(
        (item) =>
          item.role === 'assistant' &&
          !turn.knownMessageIds.has(item.id) &&
          item.activities.some((activity) => activityIds.has(activity.id)),
      )
    );
  }

  async function selectConversation(id: string) {
    const token = auth.state.token;
    if (!token) return;
    cancelCurrentRequest();
    const version = ++requestVersion;
    const controller = new AbortController();
    abortController = controller;
    currentTurn = null;
    activeConversationId.value = id;
    messages.value = [];
    draft.value = '';
    errorMessage.value = '';
    historyError.value = '';
    firstLoadedPage.value = 1;
    status.value = 'loading';
    try {
      const { detail, items, page } = await latestDetail(
        token,
        id,
        controller.signal,
      );
      if (version !== requestVersion || disposed) return;
      upsertConversation(toConversation(detail));
      const saved = items.map(toChatMessage);
      const uncertain = uncertainTurns.get(id);
      if (uncertain && !reconcileUncertain(uncertain, saved)) {
        messages.value = [...saved, uncertain.user, uncertain.assistant];
        status.value = 'unknown';
        errorMessage.value =
          '历史记录暂不能确认中断轮次是否保存，可以再次刷新核实';
      } else {
        uncertainTurns.delete(id);
        messages.value = saved;
        status.value = saved.length ? 'success' : 'empty';
      }
      firstLoadedPage.value = page;
    } catch (error) {
      if (version !== requestVersion || disposed || controller.signal.aborted)
        return;
      status.value = uncertainTurns.has(id) ? 'unknown' : 'error';
      const uncertain = uncertainTurns.get(id);
      if (uncertain) messages.value = [uncertain.user, uncertain.assistant];
      errorMessage.value =
        error instanceof Error ? error.message : '会话加载失败';
    } finally {
      if (version === requestVersion) abortController = null;
    }
  }

  async function loadEarlierMessages() {
    const token = auth.state.token;
    const id = activeConversationId.value;
    if (
      !token ||
      !id ||
      !hasEarlierMessages.value ||
      isLoadingEarlierMessages.value ||
      isSending.value
    )
      return;
    const version = requestVersion;
    const controller = new AbortController();
    historyController = controller;
    isLoadingEarlierMessages.value = true;
    historyError.value = '';
    try {
      const detail = await getConversation(
        token,
        id,
        firstLoadedPage.value - 1,
        controller.signal,
      );
      if (version !== requestVersion || disposed) return;
      const existing = new Set(messages.value.map((item) => item.id));
      messages.value = [
        ...detail.messages.items
          .filter((item) => !existing.has(item.id))
          .map(toChatMessage),
        ...messages.value,
      ];
      firstLoadedPage.value -= 1;
    } catch (error) {
      if (version !== requestVersion || disposed || controller.signal.aborted)
        return;
      historyError.value =
        error instanceof Error ? error.message : '更早消息加载失败';
    } finally {
      if (version === requestVersion && !disposed) {
        isLoadingEarlierMessages.value = false;
        historyController = null;
      }
    }
  }

  async function refreshUncertainTurn() {
    if (activeConversationId.value && status.value === 'unknown')
      await selectConversation(activeConversationId.value);
  }

  async function sendMessage() {
    const token = auth.state.token;
    if (!token || !canSend.value) return;
    const content = draft.value.trim();
    cancelCurrentRequest();
    const version = ++requestVersion;
    const controller = new AbortController();
    abortController = controller;
    const turn: PendingTurn = {
      conversationId: activeConversationId.value,
      user: createPendingMessage(`pending-user-${version}`, 'user', content),
      assistant: createPendingMessage(
        `pending-assistant-${version}`,
        'assistant',
      ),
      knownMessageIds: new Set(messages.value.map((item) => item.id)),
    };
    currentTurn = turn;
    messages.value = [...messages.value, turn.user, turn.assistant];
    draft.value = '';
    errorMessage.value = '';
    status.value = 'streaming';
    streamStartedAt = Date.now();
    updateDuration();
    streamTimer = window.setInterval(updateDuration, 1000);
    let receivedDone = false;
    let receivedError = false;
    let receivedStart = false;
    try {
      const request = {
        messages: [{ role: 'user' as const, content }],
        ...(turn.conversationId ? { conversationId: turn.conversationId } : {}),
      };
      for await (const event of streamChat(token, request, controller.signal)) {
        if (version !== requestVersion || controller.signal.aborted || disposed)
          return;
        if (event.type === 'start') {
          receivedStart = true;
          turn.conversationId = event.conversationId;
          activeConversationId.value = event.conversationId;
          upsertConversation({
            id: event.conversationId,
            title: event.title,
            preview: content,
            updatedAt: '刚刚',
          });
        }
        applyTurnEvent(turn.assistant, event);
        publishMessages();
        if (event.type === 'error') {
          receivedError = true;
          finishTurn(turn.assistant, 'failed');
          finishTurn(turn.user, 'failed');
          status.value = 'error';
          errorMessage.value = event.message;
          publishMessages();
          return;
        }
        if (event.type === 'done') {
          receivedDone = true;
          finishDuration();
          finishTurn(turn.user, 'saved');
          status.value = 'success';
          const { detail, items, page } = await latestDetail(
            token,
            event.conversationId,
            controller.signal,
          );
          if (
            version !== requestVersion ||
            controller.signal.aborted ||
            disposed
          )
            return;
          upsertConversation(toConversation(detail));
          const saved = items.map(toChatMessage);
          const renderedKeys = new Map(
            messages.value.map((item) => [item.id, item.renderKey]),
          );
          for (const item of saved) item.renderKey = renderedKeys.get(item.id);
          const last = [...saved]
            .reverse()
            .find((item) => item.role === 'assistant');
          if (last && last.content === turn.assistant.content) {
            last.renderKey = turn.assistant.id;
            if (turn.assistant.duration)
              last.duration = turn.assistant.duration;
            const previous = saved[saved.indexOf(last) - 1];
            if (previous?.role === 'user' && previous.content === content)
              previous.renderKey = turn.user.id;
          }
          const receivedIds = new Set(saved.map((item) => item.id));
          const earlier = messages.value.filter(
            (item) =>
              item.status === 'saved' &&
              item.id !== turn.user.id &&
              item.id !== turn.assistant.id &&
              !receivedIds.has(item.id),
          );
          messages.value = [...earlier, ...saved];
          firstLoadedPage.value = earlier.length
            ? Math.min(firstLoadedPage.value, page)
            : page;
        }
        if (event.type === 'delta') await nextTick();
      }
      if (
        !receivedDone &&
        !receivedError &&
        version === requestVersion &&
        !controller.signal.aborted
      )
        markUncertain();
    } catch (error) {
      if (version !== requestVersion || disposed || controller.signal.aborted)
        return;
      if (receivedDone) {
        status.value = 'success';
        errorMessage.value = '回复已保存，但历史记录刷新失败';
      } else if (
        turn.conversationId &&
        (receivedStart || !(error instanceof ApiError && error.status > 0))
      )
        markUncertain();
      else {
        finishTurn(turn.assistant, 'failed');
        finishTurn(turn.user, 'failed');
        status.value = 'error';
        errorMessage.value =
          error instanceof Error ? error.message : '聊天请求失败';
        publishMessages();
      }
    } finally {
      // 旧请求结束时不能清理新一轮的计时器、控制器或页面状态。
      if (version === requestVersion && !disposed) {
        finishDuration();
        abortController = null;
        currentTurn = null;
      }
    }
  }

  function stopGeneration() {
    if (!isSending.value) return;
    cancelCurrentRequest();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      void sendMessage();
    }
  }

  onMounted(() => {
    void loadConversations();
  });
  onBeforeUnmount(() => {
    cancelCurrentRequest();
    disposed = true;
    requestVersion += 1;
    listVersion += 1;
    listController?.abort();
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
    context,
    contextIsPrevious,
    hasEarlierMessages,
    isLoadingEarlierMessages,
    historyError,
    loadEarlierMessages,
  };
}
