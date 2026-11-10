import { defineStore } from 'pinia';
import {
  computed,
  nextTick,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { ApiError } from '@/api';
import {
  deleteConversation as deleteConversationRequest,
  getConversation,
  listConversations,
  streamChat,
} from '@/api/modules/chat';
import {
  confirmPurchase,
  discardPurchaseDraft,
  getPurchaseDraft,
  listPurchaseSkus,
  patchPurchaseDraft,
  startPurchase,
} from '@/api/modules/chat-purchase';
import {
  getNextProductPage,
  isProductPageResponse,
} from '@/api/modules/product-catalog';
import { flushMemoryTasks } from '@/api/modules/memories';
import type {
  ChatApiConversation,
  ChatProductResults,
  Conversation,
} from '@/api/types/chat';
import type {
  PatchPurchasePayload,
  PurchaseDraftResponse,
  PurchaseSkuOption,
  StartPurchasePayload,
} from '@/api/types/chat-purchase';
import { auth } from '@/lib/auth';
import {
  latestDetail,
  mergeSavedMessages,
  reconcileUncertain,
} from './history';
import {
  createChatSession,
  type ChatSession,
  type PendingTurn,
} from './session';
import {
  applyTurnEvent,
  createPendingMessage,
  finishTurn,
  toChatMessage,
} from './turn';

interface GenerationTask extends PendingTurn {
  controller: AbortController;
  startedAt: number;
  timer?: ReturnType<typeof setInterval>;
  receivedDone: boolean;
  pendingProductResults: ChatProductResults[];
}

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

export const useChatStore = defineStore('chat', () => {
  // 递归工具数据只做快照替换；任务生命周期归 Store，不随聊天页面卸载而结束。
  const sessions = shallowRef<Record<string, ChatSession>>({});
  const activeSessionKey = ref<string | null>(null);
  const conversationItems = ref<Conversation[]>([]);
  const conversationListStatus = ref<'loading' | 'success' | 'empty' | 'error'>(
    'loading',
  );
  const conversationListError = ref('');
  const isLoadingMoreConversations = ref(false);
  const deletingConversationId = ref<string | null>(null);
  const hasMoreConversations = ref(false);
  const conversationPage = ref(1);
  const generatingSessionKeys = ref<string[]>([]);
  const tasks = new Map<string, GenerationTask>();
  const uncertainTurns = new Map<string, PendingTurn>();
  const historyRequests = new Map<string, AbortController>();
  let listController: AbortController | null = null;
  let listVersion = 0;
  let sessionSequence = 0;
  let taskSequence = 0;
  let identityVersion = 0;
  let pendingListUpdates: Set<string> | null = null;
  let chatPageVisible = false;
  const purchaseReadRequests = new Map<string, AbortController>();
  const purchaseMutationRequests = new Map<string, AbortController>();
  const purchaseMutationLocks = new Set<string>();
  let purchaseSequence = 0;

  const activeSession = computed(() =>
    activeSessionKey.value ? sessions.value[activeSessionKey.value] : undefined,
  );
  const activeConversationId = computed(
    () =>
      activeSession.value?.conversationId ?? activeSession.value?.key ?? null,
  );
  const messages = computed(() => activeSession.value?.messages ?? []);
  const status = computed(() => activeSession.value?.status ?? 'idle');
  const errorMessage = computed(() => activeSession.value?.errorMessage ?? '');
  const streamDuration = computed(
    () => activeSession.value?.streamDuration ?? null,
  );
  const historyError = computed(() => activeSession.value?.historyError ?? '');
  const hasEarlierMessages = computed(
    () => (activeSession.value?.firstLoadedPage ?? 1) > 1,
  );
  const isLoadingEarlierMessages = computed(
    () => activeSession.value?.isLoadingEarlierMessages ?? false,
  );
  const isSending = computed(() => status.value === 'streaming');
  const isActiveTaskRunning = computed(
    () =>
      activeSessionKey.value !== null &&
      generatingSessionKeys.value.includes(activeSessionKey.value),
  );
  const canSubmit = computed(
    () =>
      !isActiveTaskRunning.value &&
      !(
        activeConversationId.value &&
        purchaseMutationLocks.has(
          purchaseRequestKey(activeConversationId.value),
        )
      ) &&
      (!deletingConversationId.value ||
        deletingConversationId.value !== activeConversationId.value) &&
      !['loading', 'unknown'].includes(status.value),
  );
  const canDeleteConversations = computed(
    () => deletingConversationId.value === null,
  );
  const hasActiveConversation = computed(
    () => activeSession.value !== undefined,
  );
  const generatingConversationIds = computed(() =>
    generatingSessionKeys.value.map(
      (key) => sessions.value[key]?.conversationId ?? key,
    ),
  );
  const conversations = computed(() => {
    const local = Object.values(sessions.value)
      .filter(
        (session) => !session.conversationId && session.messages.length > 0,
      )
      .map((session) => ({
        id: session.key,
        title: session.title,
        preview: session.messages[0]?.content ?? '',
        updatedAt: '刚刚',
      }));
    return [...local, ...conversationItems.value];
  });
  const activeConversation = computed(
    () =>
      conversations.value.find(
        (item) => item.id === activeConversationId.value,
      ) ??
      (activeSession.value
        ? {
            id: activeSession.value.conversationId ?? activeSession.value.key,
            title: activeSession.value.title,
            preview: '',
            updatedAt: '',
          }
        : undefined),
  );
  const context = computed(
    () =>
      [...messages.value]
        .reverse()
        .find((item) => item.role === 'assistant' && item.status === 'saved')
        ?.context ?? null,
  );
  const contextIsPrevious = computed(() => isSending.value);
  const purchase = computed(
    () =>
      activeSession.value?.purchase ?? {
        status: 'idle' as const,
        draft: null,
        order: null,
        errorMessage: '',
        requestVersion: 0,
        autoPromptedStartKeys: [],
      },
  );

  function updateSession(key: string, patch: Partial<ChatSession>) {
    const session = sessions.value[key];
    if (session)
      sessions.value = { ...sessions.value, [key]: { ...session, ...patch } };
  }

  function updatePurchase(
    key: string,
    patch: Partial<ChatSession['purchase']>,
  ): void {
    const session = sessions.value[key];
    if (!session) return;
    updateSession(key, {
      purchase: { ...session.purchase, ...patch },
    });
  }

  function purchaseSession(conversationId: string): ChatSession | undefined {
    return findSession(conversationId);
  }

  function purchaseRequestKey(conversationId: string): string {
    return `${auth.state.user?.id ?? 'anonymous'}:${conversationId}`;
  }

  function ownsPurchaseSession(
    identity: { version: number; userId: string | undefined },
    sessionKey: string,
    conversationId: string,
  ): boolean {
    const session = sessions.value[sessionKey];
    return (
      identity.version === identityVersion &&
      identity.userId === auth.state.user?.id &&
      session?.conversationId === conversationId
    );
  }

  function beginPurchaseMutation(requestKey: string): AbortController | null {
    if (purchaseMutationLocks.has(requestKey)) return null;
    purchaseReadRequests.get(requestKey)?.abort();
    purchaseReadRequests.delete(requestKey);
    purchaseMutationLocks.add(requestKey);
    const controller = new AbortController();
    purchaseMutationRequests.set(requestKey, controller);
    return controller;
  }

  function finishPurchaseMutation(
    requestKey: string,
    controller: AbortController,
  ): void {
    if (purchaseMutationRequests.get(requestKey) !== controller) return;
    purchaseMutationRequests.delete(requestKey);
    purchaseMutationLocks.delete(requestKey);
  }

  async function attachSkuOptions(
    token: string,
    response: PurchaseDraftResponse,
    signal: AbortSignal,
  ): Promise<PurchaseDraftResponse> {
    // 规格接口可能分页返回，前端只把服务端真实组合完整收集后交给选择器。
    const draft = response.draft;
    if (
      !draft ||
      draft.skuOptions?.length ||
      ['submitted', 'cancelled', 'expired'].includes(draft.status)
    )
      return response;
    const items: PurchaseSkuOption[] = [];
    let page = 1;
    let total = 0;
    do {
      const result = await listPurchaseSkus(
        token,
        draft.productExternalId,
        page,
        100,
        signal,
      );
      items.push(...result.items);
      total = result.total;
      page += 1;
      if (!result.items.length) break;
    } while (items.length < total && page <= 20);
    return {
      ...response,
      draft: { ...draft, skuOptions: items },
    };
  }

  async function loadPurchaseDraft(
    conversationId = activeConversationId.value,
  ): Promise<PurchaseDraftResponse | null> {
    const token = auth.state.token;
    if (!token || !conversationId) return null;
    const session = purchaseSession(conversationId);
    if (!session) return null;
    const requestKey = purchaseRequestKey(conversationId);
    if (purchaseMutationLocks.has(requestKey)) return null;
    purchaseReadRequests.get(requestKey)?.abort();
    const controller = new AbortController();
    purchaseReadRequests.set(requestKey, controller);
    const identity = { version: identityVersion, userId: auth.state.user?.id };
    const requestVersion = ++purchaseSequence;
    updatePurchase(session.key, {
      status: 'loading',
      errorMessage: '',
      requestVersion,
    });
    try {
      const result = await attachSkuOptions(
        token,
        await getPurchaseDraft(token, conversationId, controller.signal),
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        purchaseReadRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId) ||
        purchaseMutationLocks.has(requestKey) ||
        requestVersion !== sessions.value[session.key]?.purchase.requestVersion
      )
        return null;
      updatePurchase(session.key, {
        status: result.draft ? 'success' : 'empty',
        draft: result.draft,
        order: result.order,
        errorMessage: '',
      });
      return result;
    } catch (error) {
      if (
        controller.signal.aborted ||
        purchaseReadRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId) ||
        purchaseMutationLocks.has(requestKey)
      )
        return null;
      updatePurchase(session.key, {
        status: 'error',
        errorMessage:
          error instanceof Error ? error.message : '购买草稿加载失败',
      });
      return null;
    } finally {
      if (purchaseReadRequests.get(requestKey) === controller)
        purchaseReadRequests.delete(requestKey);
    }
  }

  async function startPurchaseForProduct(
    externalId: string,
    replace = false,
  ): Promise<boolean> {
    const token = auth.state.token;
    const session = activeSession.value;
    const conversationId = session?.conversationId;
    if (
      !token ||
      !session ||
      !conversationId ||
      !externalId.trim() ||
      session.status === 'streaming' ||
      ['loading', 'submitting', 'unknown', 'error'].includes(
        session.purchase.status,
      )
    )
      return false;
    const current = session.purchase.draft;
    if (
      current &&
      current.status !== 'submitted' &&
      current.status !== 'cancelled' &&
      current.status !== 'expired' &&
      current.productExternalId !== externalId &&
      !replace
    ) {
      updatePurchase(session.key, {
        status: 'error',
        errorMessage: '当前会话已有其他商品购买草稿，请先确认替换。',
      });
      return false;
    }
    const requestKey = purchaseRequestKey(conversationId);
    const controller = beginPurchaseMutation(requestKey);
    if (!controller) return false;
    const identity = { version: identityVersion, userId: auth.state.user?.id };
    const requestVersion = ++purchaseSequence;
    updatePurchase(session.key, {
      status: 'submitting',
      errorMessage: '',
      requestVersion,
    });
    const payload: StartPurchasePayload = {
      productExternalId: externalId.trim(),
      expectedVersion:
        current &&
        !['submitted', 'cancelled', 'expired'].includes(current.status)
          ? current.version
          : null,
    };
    let conflict = false;
    let shouldAutoPrompt = false;
    try {
      const result = await attachSkuOptions(
        token,
        await startPurchase(token, conversationId, payload, controller.signal),
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        purchaseMutationRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId)
      )
        return false;
      const draft = result.draft;
      updatePurchase(session.key, {
        status: draft ? 'success' : 'empty',
        draft,
        order: result.order,
        errorMessage: '',
      });
      if (draft) {
        const promptKey = draft.id;
        const prompted =
          sessions.value[session.key]?.purchase.autoPromptedStartKeys.includes(
            promptKey,
          ) ?? false;
        if (!prompted) {
          updatePurchase(session.key, {
            autoPromptedStartKeys: [
              ...(sessions.value[session.key]?.purchase.autoPromptedStartKeys ??
                []),
              promptKey,
            ],
          });
          shouldAutoPrompt = true;
        }
      }
      return Boolean(draft);
    } catch (error) {
      if (
        controller.signal.aborted ||
        purchaseMutationRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId)
      )
        return false;
      if (error instanceof ApiError && error.status === 409) {
        conflict = true;
      } else {
        updatePurchase(session.key, {
          status:
            error instanceof ApiError && error.status === 0
              ? 'unknown'
              : 'error',
          errorMessage:
            error instanceof Error ? error.message : '购买草稿创建失败',
        });
      }
    } finally {
      finishPurchaseMutation(requestKey, controller);
      if (
        shouldAutoPrompt &&
        ownsPurchaseSession(identity, session.key, conversationId) &&
        sessions.value[session.key]?.status !== 'streaming'
      )
        void sendMessage('请帮我继续本次购买');
    }
    if (conflict && ownsPurchaseSession(identity, session.key, conversationId))
      await loadPurchaseDraft(conversationId);
    return false;
  }

  async function updatePurchaseDraft(
    payload: Omit<PatchPurchasePayload, 'expectedVersion'>,
  ): Promise<boolean> {
    const token = auth.state.token;
    const session = activeSession.value;
    const draft = session?.purchase.draft;
    if (
      !token ||
      !session?.conversationId ||
      !draft ||
      session.status === 'streaming' ||
      session.purchase.status !== 'success' ||
      !['collecting', 'ready'].includes(draft.status)
    )
      return false;
    const conversationId = session.conversationId;
    const requestKey = purchaseRequestKey(conversationId);
    const controller = beginPurchaseMutation(requestKey);
    if (!controller) return false;
    const identity = { version: identityVersion, userId: auth.state.user?.id };
    const requestVersion = ++purchaseSequence;
    updatePurchase(session.key, {
      status: 'submitting',
      errorMessage: '',
      requestVersion,
    });
    let conflict = false;
    try {
      const result = await patchPurchaseDraft(
        token,
        conversationId,
        draft.id,
        { ...payload, expectedVersion: draft.version },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        purchaseMutationRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId)
      )
        return false;
      updatePurchase(session.key, {
        status: 'success',
        draft: {
          ...result,
          skuOptions: result.skuOptions ?? draft.skuOptions,
        },
        errorMessage: '',
      });
      return true;
    } catch (error) {
      if (
        controller.signal.aborted ||
        purchaseMutationRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId)
      )
        return false;
      if (error instanceof ApiError && error.status === 409) conflict = true;
      else
        updatePurchase(session.key, {
          status:
            error instanceof ApiError && error.status === 0
              ? 'unknown'
              : 'error',
          errorMessage:
            error instanceof Error ? error.message : '购买信息更新失败',
        });
    } finally {
      finishPurchaseMutation(requestKey, controller);
    }
    if (conflict && ownsPurchaseSession(identity, session.key, conversationId))
      await loadPurchaseDraft(conversationId);
    return false;
  }

  async function discardPurchase(): Promise<boolean> {
    const token = auth.state.token;
    const session = activeSession.value;
    const draft = session?.purchase.draft;
    if (
      !token ||
      !session?.conversationId ||
      !draft ||
      session.status === 'streaming' ||
      session.purchase.status !== 'success' ||
      !['collecting', 'ready'].includes(draft.status)
    )
      return false;
    const conversationId = session.conversationId;
    const requestKey = purchaseRequestKey(conversationId);
    const controller = beginPurchaseMutation(requestKey);
    if (!controller) return false;
    const identity = { version: identityVersion, userId: auth.state.user?.id };
    updatePurchase(session.key, { status: 'submitting', errorMessage: '' });
    let conflict = false;
    try {
      const result = await discardPurchaseDraft(
        token,
        conversationId,
        draft.id,
        { expectedVersion: draft.version },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        purchaseMutationRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId)
      )
        return false;
      updatePurchase(session.key, {
        status: 'success',
        draft: { ...result, skuOptions: result.skuOptions ?? draft.skuOptions },
        errorMessage: '',
      });
      return true;
    } catch (error) {
      if (
        controller.signal.aborted ||
        purchaseMutationRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId)
      )
        return false;
      if (error instanceof ApiError && error.status === 409) conflict = true;
      else
        updatePurchase(session.key, {
          status:
            error instanceof ApiError && error.status === 0
              ? 'unknown'
              : 'error',
          errorMessage: error instanceof Error ? error.message : '放弃购买失败',
        });
    } finally {
      finishPurchaseMutation(requestKey, controller);
    }
    if (conflict && ownsPurchaseSession(identity, session.key, conversationId))
      await loadPurchaseDraft(conversationId);
    return false;
  }

  async function confirmPurchaseOrder(): Promise<boolean> {
    const token = auth.state.token;
    const session = activeSession.value;
    const draft = session?.purchase.draft;
    if (
      !token ||
      !session?.conversationId ||
      !draft ||
      session.status === 'streaming' ||
      session.purchase.status !== 'success' ||
      draft.status !== 'ready' ||
      !draft.confirmation
    )
      return false;
    const conversationId = session.conversationId;
    const requestKey = purchaseRequestKey(conversationId);
    const controller = beginPurchaseMutation(requestKey);
    if (!controller) return false;
    const identity = { version: identityVersion, userId: auth.state.user?.id };
    updatePurchase(session.key, { status: 'submitting', errorMessage: '' });
    let conflict = false;
    try {
      const result = await confirmPurchase(
        token,
        conversationId,
        draft.id,
        { expectedVersion: draft.version },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        purchaseMutationRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId)
      )
        return false;
      updatePurchase(session.key, {
        status: result.draft ? 'success' : 'empty',
        draft: result.draft
          ? {
              ...result.draft,
              skuOptions: result.draft.skuOptions ?? draft.skuOptions,
            }
          : null,
        order: result.order,
        errorMessage: '',
      });
      return Boolean(result.order);
    } catch (error) {
      if (
        controller.signal.aborted ||
        purchaseMutationRequests.get(requestKey) !== controller ||
        !ownsPurchaseSession(identity, session.key, conversationId)
      )
        return false;
      if (error instanceof ApiError && error.status === 409) conflict = true;
      else
        updatePurchase(session.key, {
          status:
            error instanceof ApiError && error.status === 0
              ? 'unknown'
              : 'error',
          errorMessage: error instanceof Error ? error.message : '确认下单失败',
        });
    } finally {
      finishPurchaseMutation(requestKey, controller);
    }
    if (conflict && ownsPurchaseSession(identity, session.key, conversationId))
      await loadPurchaseDraft(conversationId);
    return false;
  }

  function findSession(id: string) {
    return Object.values(sessions.value).find(
      (session) => session.key === id || session.conversationId === id,
    );
  }

  function markOrderCancellationComplete(
    sessionKey: string,
    orderId: string,
  ): void {
    const session = sessions.value[sessionKey];
    if (!session) return;
    updateSession(sessionKey, {
      messages: session.messages.map((message) => ({
        ...message,
        orderCancellationCandidates: message.orderCancellationCandidates.map(
          (candidate) =>
            candidate.orderId === orderId
              ? { ...candidate, cancellationResult: 'cancelled' }
              : candidate,
        ),
      })),
    });
  }

  function flushConversation(id: string | null, keepalive = false) {
    const token = auth.state.token;
    if (!id || !token) return;
    void flushMemoryTasks(token, id, keepalive).catch(() => {
      // 提前提取只是尽力触发，失败由服务端静默期调度兜底。
    });
  }

  function flushActiveConversation() {
    const session = activeSession.value;
    if (session && !tasks.has(session.key))
      flushConversation(session.conversationId);
  }

  function setChatPageVisible(visible: boolean) {
    chatPageVisible = visible;
    if (!visible) flushActiveConversation();
  }

  function upsertConversation(conversation: Conversation) {
    pendingListUpdates?.add(conversation.id);
    const index = conversationItems.value.findIndex(
      (item) => item.id === conversation.id,
    );
    if (index < 0) conversationItems.value.unshift(conversation);
    else
      conversationItems.value[index] = {
        ...conversationItems.value[index],
        ...conversation,
      };
    conversationListStatus.value = 'success';
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
      if (version !== listVersion || controller.signal.aborted) return;
      const received = response.items.map(toConversation);
      const existing = new Set(conversationItems.value.map((item) => item.id));
      const updated = conversationItems.value.filter(
        (item) =>
          updates.has(item.id) ||
          generatingConversationIds.value.includes(item.id),
      );
      const updatedIds = new Set(updated.map((item) => item.id));
      conversationItems.value = append
        ? [
            ...conversationItems.value,
            ...received.filter((item) => !existing.has(item.id)),
          ]
        : [...updated, ...received.filter((item) => !updatedIds.has(item.id))];
      conversationPage.value = page;
      hasMoreConversations.value = response.page < response.totalPages;
      conversationListStatus.value = conversations.value.length
        ? 'success'
        : 'empty';
    } catch (error) {
      if (version !== listVersion || controller.signal.aborted) return;
      conversationListStatus.value = 'error';
      conversationListError.value =
        error instanceof Error ? error.message : '会话列表加载失败';
    } finally {
      if (version === listVersion) {
        isLoadingMoreConversations.value = false;
        pendingListUpdates = null;
        listController = null;
      }
    }
  }

  function loadMoreConversations() {
    void loadConversations(conversationPage.value + 1, true);
  }

  function startNewConversation() {
    flushActiveConversation();
    activeSessionKey.value = null;
  }

  async function loadMoreProducts(messageId: string, resultIndex: number) {
    const token = auth.state.token;
    const key = activeSessionKey.value;
    if (!token || !key) return;
    const session = sessions.value[key];
    const message = session?.messages.find((item) => item.id === messageId);
    const result = message?.productResults[resultIndex];
    if (!session || !message || !result?.query || !result.nextCursor) return;
    if (result.loadingMore) return;

    // 固定会话与消息定位，路由切换后响应仍追加回发起请求的结果组。
    const updateResult = (
      transform: (current: ChatProductResults) => ChatProductResults,
    ) => {
      const currentSession = sessions.value[key];
      if (!currentSession) return;
      const currentMessage = currentSession.messages.find(
        (item) => item.id === messageId,
      );
      const currentResult = currentMessage?.productResults[resultIndex];
      if (!currentMessage || !currentResult) return;
      const productResults = [...currentMessage.productResults];
      productResults[resultIndex] = transform(currentResult);
      updateSession(key, {
        messages: currentSession.messages.map((item) =>
          item.id === messageId ? { ...item, productResults } : item,
        ),
      });
    };

    updateResult((current) => ({
      ...current,
      loadingMore: true,
      loadMoreError: '',
    }));
    try {
      const page = await getNextProductPage(
        token,
        result.query,
        result.nextCursor,
      );
      if (!isProductPageResponse(page)) throw new Error('商品数据格式无效');
      updateResult((current) => ({
        ...current,
        items: [
          ...current.items,
          ...page.items.filter(
            (item) =>
              !current.items.some(
                (existing) => existing.externalId === item.externalId,
              ),
          ),
        ],
        nextCursor: page.nextCursor,
        noResultReason: current.items.length ? null : page.noResultReason,
        loadingMore: false,
        loadMoreError: '',
      }));
    } catch (error) {
      updateResult((current) => ({
        ...current,
        loadingMore: false,
        loadMoreError:
          error instanceof Error ? error.message : '商品加载失败，请重试',
      }));
    }
  }

  async function selectConversation(id: string, refresh = false) {
    const token = auth.state.token;
    if (!token) return;
    let session = findSession(id);
    if (activeSessionKey.value !== session?.key) flushActiveConversation();
    if (!session) {
      session = createChatSession(
        `conversation-${++sessionSequence}`,
        id,
        conversationItems.value.find((item) => item.id === id)?.title,
      );
      sessions.value = { ...sessions.value, [session.key]: session };
    }
    const key = session.key;
    activeSessionKey.value = key;
    // 运行中的会话直接恢复同一份增量，禁止历史请求覆盖尚未完成的流。
    if (
      tasks.has(key) ||
      !session.conversationId ||
      (!refresh &&
        session.status !== 'idle' &&
        (session.status !== 'error' || session.messages.length > 0))
    )
      return;
    historyRequests.get(key)?.abort();
    const controller = new AbortController();
    historyRequests.set(key, controller);
    updateSession(key, {
      status: 'loading',
      errorMessage: '',
      historyError: '',
    });
    try {
      const { detail, items, page } = await latestDetail(
        token,
        session.conversationId,
        controller.signal,
      );
      if (controller.signal.aborted || historyRequests.get(key) !== controller)
        return;
      upsertConversation(toConversation(detail));
      const saved = items.map(toChatMessage);
      const uncertain = uncertainTurns.get(key);
      const unresolved = uncertain && !reconcileUncertain(uncertain, saved);
      if (!unresolved) uncertainTurns.delete(key);
      updateSession(key, {
        title: detail.title,
        messages: unresolved
          ? [...saved, uncertain.user, uncertain.assistant]
          : saved,
        status: unresolved ? 'unknown' : saved.length ? 'success' : 'empty',
        errorMessage: unresolved
          ? '历史记录暂不能确认中断轮次是否保存，可以再次刷新核实'
          : '',
        firstLoadedPage: page,
      });
      void loadPurchaseDraft(detail.id);
    } catch (error) {
      if (controller.signal.aborted || historyRequests.get(key) !== controller)
        return;
      const uncertain = uncertainTurns.get(key);
      updateSession(key, {
        status: uncertain ? 'unknown' : 'error',
        ...(uncertain && { messages: [uncertain.user, uncertain.assistant] }),
        errorMessage: error instanceof Error ? error.message : '会话加载失败',
      });
    } finally {
      if (historyRequests.get(key) === controller) historyRequests.delete(key);
    }
  }

  async function loadEarlierMessages() {
    const token = auth.state.token;
    const session = activeSession.value;
    if (
      !token ||
      !session?.conversationId ||
      session.firstLoadedPage <= 1 ||
      session.isLoadingEarlierMessages ||
      tasks.has(session.key)
    )
      return;
    const key = session.key;
    historyRequests.get(key)?.abort();
    const controller = new AbortController();
    historyRequests.set(key, controller);
    updateSession(key, { isLoadingEarlierMessages: true, historyError: '' });
    try {
      const detail = await getConversation(
        token,
        session.conversationId,
        session.firstLoadedPage - 1,
        controller.signal,
      );
      if (controller.signal.aborted || historyRequests.get(key) !== controller)
        return;
      const current = sessions.value[key];
      if (!current) return;
      const existing = new Set(current.messages.map((item) => item.id));
      updateSession(key, {
        messages: [
          ...detail.messages.items
            .filter((item) => !existing.has(item.id))
            .map(toChatMessage),
          ...current.messages,
        ],
        firstLoadedPage: session.firstLoadedPage - 1,
      });
    } catch (error) {
      if (!controller.signal.aborted && historyRequests.get(key) === controller)
        updateSession(key, {
          historyError:
            error instanceof Error ? error.message : '更早消息加载失败',
        });
    } finally {
      if (historyRequests.get(key) === controller) {
        historyRequests.delete(key);
        updateSession(key, { isLoadingEarlierMessages: false });
      }
    }
  }

  function publishTurn(key: string, task: GenerationTask) {
    const session = sessions.value[key];
    if (!session || tasks.get(key) !== task) return;
    // 子组件按 Props 身份更新，不能复用仍在累加正文的对象。
    task.assistant = {
      ...task.assistant,
      activities: [...task.assistant.activities],
      sources: [...task.assistant.sources],
      productResults: [...task.assistant.productResults],
    };
    task.user = { ...task.user };
    updateSession(key, {
      messages: session.messages.map((item) =>
        item.id === task.assistant.id
          ? task.assistant
          : item.id === task.user.id
            ? task.user
            : item,
      ),
    });
  }

  function updateDuration(key: string, task: GenerationTask) {
    if (tasks.get(key) !== task) return;
    const seconds = Math.floor((Date.now() - task.startedAt) / 1000);
    const duration =
      seconds >= 60
        ? `用时 ${Math.floor(seconds / 60)}分 ${seconds % 60}秒`
        : `用时 ${seconds}秒`;
    task.assistant.duration = duration;
    updateSession(key, { streamDuration: duration });
    publishTurn(key, task);
  }

  function markUncertain(key: string, task: GenerationTask) {
    if (tasks.get(key) !== task) return;
    finishTurn(task.assistant, 'uncertain');
    uncertainTurns.set(key, task);
    publishTurn(key, task);
    const hasId = Boolean(sessions.value[key]?.conversationId);
    updateSession(key, {
      status: hasId ? 'unknown' : 'error',
      errorMessage: hasId
        ? '生成已中断，尚无法确认本轮是否保存。请刷新核实后再继续'
        : '生成已中断，尚未取得会话编号，无法核实保存状态',
    });
  }

  function releaseTask(key: string, task: GenerationTask) {
    if (tasks.get(key) !== task) return;
    clearInterval(task.timer);
    tasks.delete(key);
    generatingSessionKeys.value = generatingSessionKeys.value.filter(
      (item) => item !== key,
    );
  }

  async function sendMessage(content: string) {
    const token = auth.state.token;
    if (!token || !canSubmit.value || !content.trim() || content.length > 2000)
      return;
    let session = activeSession.value;
    if (!session) {
      session = createChatSession(
        `local-${++sessionSequence}`,
        null,
        content.trim().slice(0, 30),
      );
      sessions.value = { ...sessions.value, [session.key]: session };
      activeSessionKey.value = session.key;
    }
    const key = session.key;
    historyRequests.get(key)?.abort();
    historyRequests.delete(key);
    const sequence = ++taskSequence;
    const task: GenerationTask = {
      controller: new AbortController(),
      startedAt: Date.now(),
      receivedDone: false,
      pendingProductResults: [],
      user: createPendingMessage(
        `pending-user-${sequence}`,
        'user',
        content.trim(),
      ),
      assistant: createPendingMessage(
        `pending-assistant-${sequence}`,
        'assistant',
      ),
      knownMessageIds: new Set(session.messages.map((item) => item.id)),
    };
    tasks.set(key, task);
    generatingSessionKeys.value = [...generatingSessionKeys.value, key];
    updateSession(key, {
      messages: [...session.messages, task.user, task.assistant],
      status: 'streaming',
      errorMessage: '',
      historyError: '',
      isLoadingEarlierMessages: false,
    });
    updateDuration(key, task);
    task.timer = setInterval(() => updateDuration(key, task), 1000);
    let receivedStart = false;
    try {
      for await (const event of streamChat(
        token,
        {
          messages: [{ role: 'user', content: content.trim() }],
          ...(session.conversationId && {
            conversationId: session.conversationId,
          }),
        },
        task.controller.signal,
      )) {
        if (tasks.get(key) !== task || task.controller.signal.aborted) return;
        if (event.type === 'start') {
          receivedStart = true;
          updateSession(key, {
            conversationId: event.conversationId,
            title: event.title,
          });
          upsertConversation({
            id: event.conversationId,
            title: event.title,
            preview: content.trim(),
            updatedAt: '刚刚',
          });
        }
        if (event.type === 'product-results')
          task.pendingProductResults.push(event.results);
        if (event.type === 'purchase') {
          const purchaseConversationId = sessions.value[key]?.conversationId;
          if (purchaseConversationId)
            void loadPurchaseDraft(purchaseConversationId);
        }
        applyTurnEvent(task.assistant, event, true);
        if (event.type === 'done' && task.pendingProductResults.length) {
          task.assistant.productResults.push(...task.pendingProductResults);
          task.pendingProductResults = [];
        }
        publishTurn(key, task);
        if (event.type === 'error') {
          finishTurn(task.assistant, 'failed');
          finishTurn(task.user, 'failed');
          publishTurn(key, task);
          updateSession(key, { status: 'error', errorMessage: event.message });
          return;
        }
        if (event.type === 'done') {
          task.receivedDone = true;
          updateDuration(key, task);
          clearInterval(task.timer);
          finishTurn(task.user, 'saved');
          publishTurn(key, task);
          updateSession(key, { status: 'success' });
          const { detail, items, page } = await latestDetail(
            token,
            event.conversationId,
            task.controller.signal,
          );
          if (tasks.get(key) !== task || task.controller.signal.aborted) return;
          upsertConversation(toConversation(detail));
          const current = sessions.value[key];
          if (!current) return;
          const merged = mergeSavedMessages(
            current.messages,
            items.map(toChatMessage),
            task,
          );
          updateSession(key, {
            title: detail.title,
            messages: merged,
            firstLoadedPage:
              merged.length > items.length
                ? Math.min(current.firstLoadedPage, page)
                : page,
          });
        }
        if (event.type === 'delta') await nextTick();
      }
      if (!task.receivedDone) markUncertain(key, task);
    } catch (error) {
      if (tasks.get(key) !== task || task.controller.signal.aborted) return;
      if (task.receivedDone)
        updateSession(key, {
          status: 'success',
          errorMessage: '回复已保存，但历史记录刷新失败',
        });
      else if (
        sessions.value[key]?.conversationId &&
        (receivedStart || !(error instanceof ApiError && error.status > 0))
      )
        markUncertain(key, task);
      else {
        finishTurn(task.assistant, 'failed');
        finishTurn(task.user, 'failed');
        publishTurn(key, task);
        updateSession(key, {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : '聊天请求失败',
        });
      }
    } finally {
      if (tasks.get(key) === task) {
        if (!task.receivedDone) updateDuration(key, task);
        releaseTask(key, task);
        if (
          task.receivedDone &&
          (!chatPageVisible || activeSessionKey.value !== key)
        )
          flushConversation(sessions.value[key]?.conversationId ?? null);
      }
    }
  }

  function stopGeneration() {
    const key = activeSessionKey.value;
    if (!key) return;
    const task = tasks.get(key);
    if (!task || task.receivedDone) return;
    updateDuration(key, task);
    markUncertain(key, task);
    task.controller.abort();
    releaseTask(key, task);
  }

  async function refreshUncertainTurn() {
    if (activeConversationId.value && status.value === 'unknown')
      await selectConversation(activeConversationId.value, true);
  }

  async function removeConversation(id: string): Promise<boolean> {
    const token = auth.state.token;
    const session = findSession(id);
    if (
      !token ||
      !canDeleteConversations.value ||
      (session && tasks.has(session.key))
    )
      return false;
    const version = identityVersion;
    deletingConversationId.value = id;
    try {
      // 首轮请求失败且未取得服务端 ID 时，仅移除本地占位，不请求无效资源。
      if (!session || session.conversationId)
        await deleteConversationRequest(token, id);
      if (version !== identityVersion) return false;
      if (session) {
        historyRequests.get(session.key)?.abort();
        historyRequests.delete(session.key);
        uncertainTurns.delete(session.key);
        const next = { ...sessions.value };
        delete next[session.key];
        sessions.value = next;
        if (activeSessionKey.value === session.key)
          activeSessionKey.value = null;
      }
      conversationItems.value = conversationItems.value.filter(
        (item) => item.id !== id,
      );
      await loadConversations();
      return version === identityVersion;
    } catch (error) {
      if (version === identityVersion)
        conversationListError.value =
          error instanceof Error ? error.message : '删除会话失败';
      return false;
    } finally {
      if (version === identityVersion) deletingConversationId.value = null;
    }
  }

  function reset() {
    identityVersion += 1;
    listVersion += 1;
    for (const task of tasks.values()) {
      task.controller.abort();
      clearInterval(task.timer);
    }
    tasks.clear();
    for (const controller of historyRequests.values()) controller.abort();
    historyRequests.clear();
    listController?.abort();
    listController = null;
    pendingListUpdates = null;
    uncertainTurns.clear();
    for (const controller of purchaseReadRequests.values()) controller.abort();
    purchaseReadRequests.clear();
    for (const controller of purchaseMutationRequests.values())
      controller.abort();
    purchaseMutationRequests.clear();
    purchaseMutationLocks.clear();
    sessions.value = {};
    activeSessionKey.value = null;
    conversationItems.value = [];
    generatingSessionKeys.value = [];
    conversationListStatus.value = 'loading';
    conversationListError.value = '';
    isLoadingMoreConversations.value = false;
    deletingConversationId.value = null;
    hasMoreConversations.value = false;
    conversationPage.value = 1;
  }

  // Token 正常刷新不影响任务；退出或切换用户必须同步清理，防止旧用户结果回流。
  watch(() => (auth.state.token ? auth.state.user?.id : null), reset, {
    flush: 'sync',
  });
  function handlePageHide() {
    for (const session of Object.values(sessions.value))
      flushConversation(session.conversationId, true);
  }
  window.addEventListener('pagehide', handlePageHide);
  onScopeDispose(() => {
    window.removeEventListener('pagehide', handlePageHide);
    reset();
  });

  return {
    sessions,
    activeSessionKey,
    conversationItems,
    hasMoreConversations,
    conversationPage,
    generatingSessionKeys,
    activeConversation,
    activeConversationId,
    canDeleteConversations,
    canSubmit,
    conversations,
    conversationListError,
    conversationListStatus,
    deletingConversationId,
    errorMessage,
    generatingConversationIds,
    hasActiveConversation,
    hasEarlierMessages,
    historyError,
    isLoadingEarlierMessages,
    isLoadingMoreConversations,
    isSending,
    messages,
    status,
    streamDuration,
    context,
    contextIsPrevious,
    loadConversations,
    loadEarlierMessages,
    loadMoreConversations,
    loadMoreProducts,
    refreshUncertainTurn,
    removeConversation,
    selectConversation,
    sendMessage,
    setChatPageVisible,
    startNewConversation,
    stopGeneration,
    purchase,
    loadPurchaseDraft,
    startPurchaseForProduct,
    updatePurchaseDraft,
    discardPurchase,
    confirmPurchaseOrder,
    markOrderCancellationComplete,
  };
});
