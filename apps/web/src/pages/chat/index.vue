<script setup lang="ts">
import { Sparkles } from '@lucide/vue';
import ChatComposer from './components/ChatComposer.vue';
import ChatHeader from './components/ChatHeader.vue';
import ChatMessageList from './components/ChatMessageList.vue';
import ConversationSidebar from './components/ConversationSidebar.vue';
import { useChatPage } from './page';

const {
  activeConversation,
  activeConversationId,
  canSend,
  conversations,
  draft,
  hasActiveConversation,
  handleKeydown,
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
} = useChatPage();
</script>

<template>
  <section
    class="chat-page flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground sm:flex-row"
  >
    <ConversationSidebar
      :active-conversation-id="activeConversationId"
      :conversations="conversations"
      @new="startNewConversation"
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
            <ChatMessageList
              :is-sending="isSending"
              :messages="messages"
              :stream-duration="streamDuration"
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
          </div>
          <div class="shrink-0 px-4 pb-4 sm:px-6 sm:pb-6">
            <ChatComposer
              :can-send="canSend"
              :draft="draft"
              :is-sending="isSending"
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
              :can-send="canSend"
              :draft="draft"
              :is-sending="isSending"
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
</template>
