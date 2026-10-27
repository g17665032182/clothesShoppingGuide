<script setup lang="ts">
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
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
  handleKeydown,
  isSending,
  messages,
  selectConversation,
  sendMessage,
  startNewConversation,
} = useChatPage();
</script>

<template>
  <section class="chat-page">
    <div class="chat-heading">
      <div>
        <p class="eyebrow">穿搭顾问</p>
        <h1>聊聊你的下一套穿搭。</h1>
      </div>
      <p class="chat-heading-copy">
        从一个场合或一件单品开始，逐步找到适合你的选择。
      </p>
    </div>

    <div class="chat-layout">
      <ConversationSidebar
        :active-conversation-id="activeConversationId"
        :conversations="conversations"
        @new="startNewConversation"
        @select="selectConversation"
      />

      <Card class="chat-panel">
        <ChatHeader
          :title="activeConversation?.title ?? '新对话'"
          @new="startNewConversation"
        />
        <Separator />
        <CardContent class="chat-panel-content">
          <ChatMessageList :is-sending="isSending" :messages="messages" />
        </CardContent>
        <CardFooter class="chat-composer">
          <ChatComposer
            :can-send="canSend"
            :draft="draft"
            @keydown="handleKeydown"
            @submit="sendMessage"
            @update:draft="draft = $event"
          />
        </CardFooter>
      </Card>
    </div>
  </section>
</template>
