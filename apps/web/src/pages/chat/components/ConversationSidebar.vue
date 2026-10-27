<script setup lang="ts">
import { MessageCircle, Plus } from '@lucide/vue';
import { cn } from '@/lib/utils';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { Conversation } from '@/api/types/chat';

defineProps<{
  activeConversationId: number;
  conversations: Conversation[];
}>();

const emit = defineEmits<{
  (event: 'new'): void;
  (event: 'select', conversationId: number): void;
}>();
</script>

<template>
  <Card class="chat-sidebar">
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <MessageCircle aria-hidden="true" data-icon="inline-start" />
        对话
      </CardTitle>
      <CardDescription>继续之前的讨论</CardDescription>
      <CardAction>
        <Button
          aria-label="新建对话"
          size="icon"
          title="新建对话"
          type="button"
          variant="ghost"
          @click="emit('new')"
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
        </Button>
      </CardAction>
    </CardHeader>
    <Separator />
    <CardContent class="chat-conversation-list">
      <button
        v-for="conversation in conversations"
        :key="conversation.id"
        :aria-current="
          conversation.id === activeConversationId ? 'true' : undefined
        "
        :class="
          cn(
            'chat-conversation flex w-full flex-col gap-1 rounded-lg p-3 text-left transition-colors',
            conversation.id === activeConversationId
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-muted',
          )
        "
        type="button"
        @click="emit('select', conversation.id)"
      >
        <span class="flex items-center justify-between gap-2">
          <strong class="truncate text-sm">{{ conversation.title }}</strong>
          <span class="shrink-0 text-xs text-muted-foreground">
            {{ conversation.updatedAt }}
          </span>
        </span>
        <span class="truncate text-xs text-muted-foreground">
          {{ conversation.preview }}
        </span>
      </button>
    </CardContent>
  </Card>
</template>
