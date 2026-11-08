<script setup lang="ts">
import { Sparkles } from '@lucide/vue';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import ChatComposer from './components/ChatComposer.vue';
import ChatHeader from './components/ChatHeader.vue';
import ChatMessageList from './components/ChatMessageList.vue';
import ChatHistoryNavigation from './components/ChatHistoryNavigation.vue';
import PurchasePanel from './components/PurchasePanel.vue';
import PurchaseReplaceDialog from './components/PurchaseReplaceDialog.vue';
import OrderDetailDialog from '@/components/shared/orders/OrderDetailDialog.vue';
import OrderActionDialog from '@/components/shared/orders/OrderActionDialog.vue';
import { useChatPage } from './page';

const {
  activeConversation,
  activeConversationId,
  canDeleteConversations,
  canSend,
  conversations,
  conversationListError,
  conversationListStatus,
  deletingConversationId,
  generatingConversationIds,
  draft,
  hasActiveConversation,
  handleKeydown,
  isLoadingMoreConversations,
  isSending,
  messages,
  streamDuration,
  errorMessage,
  refreshUncertainTurn,
  selectConversation,
  sendMessage,
  startNewConversation,
  status,
  stopGeneration,
  loadConversations,
  loadMoreConversations,
  removeConversation,
  context,
  contextIsPrevious,
  hasEarlierMessages,
  isLoadingEarlierMessages,
  historyError,
  loadEarlierMessages,
  loadMoreProducts,
  purchase,
  buyProduct,
  confirmReplacement,
  replacementDialogOpen,
  replacementProductId,
  updatePurchase,
  discardPurchase,
  confirmPurchaseOrder,
  retryPurchase,
  detailOpen,
  actionDialogOpen,
  actionType,
  order,
  detailStatus,
  actionStatus,
  error: orderError,
  loadOrder,
  requestAction,
  confirmAction,
  pay,
} = useChatPage();
</script>

<template>
  <section
    class="chat-page flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground sm:flex-row"
  >
    <ChatHistoryNavigation
      :active-conversation-id="activeConversationId"
      :can-delete-conversations="canDeleteConversations"
      :conversations="conversations"
      :conversation-list-error="conversationListError"
      :conversation-list-status="conversationListStatus"
      :deleting-conversation-id="deletingConversationId"
      :generating-conversation-ids="generatingConversationIds"
      :is-loading-more-conversations="isLoadingMoreConversations"
      @delete="removeConversation"
      @load-more="loadMoreConversations"
      @new="startNewConversation"
      @retry="loadConversations()"
      @select="selectConversation"
    />

    <main class="chat-workspace flex min-h-0 min-w-0 flex-1 flex-col">
      <div class="flex min-h-0 w-full flex-1 flex-col">
        <template v-if="hasActiveConversation">
          <ChatHeader
            :title="activeConversation?.title ?? '新对话'"
            @new="startNewConversation"
          />
          <div class="min-h-0 flex-1 overflow-hidden">
            <div
              v-if="status === 'loading'"
              class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8"
              role="status"
              aria-label="正在加载聊天记录"
            >
              <Skeleton class="h-5 w-2/3" />
              <Skeleton class="h-20 w-full" />
              <Skeleton class="h-5 w-1/2" />
            </div>
            <Empty v-else-if="status === 'empty'" class="h-full">
              <EmptyHeader>
                <EmptyTitle>暂无消息</EmptyTitle>
              </EmptyHeader>
            </Empty>
            <ChatMessageList
              v-else
              :key="activeConversationId ?? 'new'"
              :is-sending="isSending"
              :messages="messages"
              :stream-duration="streamDuration"
              :has-earlier-messages="hasEarlierMessages"
              :is-loading-earlier-messages="isLoadingEarlierMessages"
              :history-error="historyError"
              @load-earlier="loadEarlierMessages"
              @more-products="loadMoreProducts"
              @buy-product="buyProduct"
              @open-order="loadOrder"
              @retry-history="loadEarlierMessages"
            />
          </div>
          <div class="shrink-0 px-4 pb-2 sm:px-6">
            <PurchasePanel
              :draft="purchase.draft"
              :order="purchase.order"
              :status="
                purchase.status === 'success' && isSending
                  ? 'streaming'
                  : purchase.status
              "
              :error-message="purchase.errorMessage"
              @update="updatePurchase($event)"
              @discard="discardPurchase"
              @confirm="confirmPurchaseOrder"
              @retry="retryPurchase"
              @open-order="loadOrder"
            />
          </div>
          <div
            v-if="errorMessage"
            class="mx-auto w-full max-w-3xl shrink-0 px-4 py-2 text-sm text-destructive sm:px-6"
            role="alert"
          >
            {{ errorMessage }}
            <button
              v-if="status === 'unknown'"
              class="ml-2 underline underline-offset-4"
              type="button"
              @click="refreshUncertainTurn"
            >
              刷新核实
            </button>
            <button
              v-else-if="status === 'error' && activeConversationId"
              class="ml-2 underline underline-offset-4"
              type="button"
              @click="selectConversation(activeConversationId)"
            >
              重新加载
            </button>
            <button
              v-else-if="status === 'success' && activeConversationId"
              class="ml-2 underline underline-offset-4"
              type="button"
              @click="selectConversation(activeConversationId)"
            >
              刷新记录
            </button>
          </div>
          <div class="shrink-0 px-4 pb-4 sm:px-6 sm:pb-6">
            <ChatComposer
              :key="activeConversationId ?? 'new'"
              :can-send="canSend"
              :draft="draft"
              :is-sending="isSending"
              :context="context"
              :context-is-previous="contextIsPrevious"
              @keydown="handleKeydown"
              @stop="stopGeneration"
              @submit="sendMessage"
              @update:draft="draft = $event"
            />
          </div>
        </template>

        <template v-else>
          <div
            class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-hidden px-6 pb-28 text-center"
          >
            <div
              class="flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground"
            >
              <Sparkles aria-hidden="true" />
            </div>
            <div class="flex flex-col gap-2">
              <h1 class="text-2xl font-medium tracking-tight sm:text-3xl">
                我们要构建什么？
              </h1>
              <p class="max-w-md text-sm text-muted-foreground">
                告诉我你的场合、天气和偏好，开始一段新的穿搭讨论。
              </p>
            </div>
          </div>
          <div
            v-if="errorMessage"
            class="mx-auto w-full max-w-3xl shrink-0 px-4 py-2 text-sm text-destructive sm:px-6"
            role="alert"
          >
            {{ errorMessage }}
            <button
              v-if="status === 'unknown'"
              class="ml-2 underline underline-offset-4"
              type="button"
              @click="refreshUncertainTurn"
            >
              刷新核实
            </button>
          </div>
          <div class="shrink-0 px-4 pb-4 sm:px-6 sm:pb-6">
            <ChatComposer
              key="new"
              :can-send="canSend"
              :draft="draft"
              :is-sending="isSending"
              :context="context"
              :context-is-previous="contextIsPrevious"
              @keydown="handleKeydown"
              @submit="sendMessage"
              @stop="stopGeneration"
              @update:draft="draft = $event"
            />
          </div>
        </template>
      </div>
    </main>
  </section>
  <PurchaseReplaceDialog
    v-model:open="replacementDialogOpen"
    :product-external-id="replacementProductId"
    @confirm="confirmReplacement"
  />
  <OrderDetailDialog
    v-model="detailOpen"
    :order="order"
    :status="detailStatus"
    :action-status="actionStatus"
    :error="orderError"
    @retry="loadOrder()"
    @pay="pay"
    @cancel="requestAction('cancel')"
    @receipt="requestAction('receipt')"
  />
  <OrderActionDialog
    v-model="actionDialogOpen"
    :action="actionType"
    @confirm="confirmAction"
  />
</template>
