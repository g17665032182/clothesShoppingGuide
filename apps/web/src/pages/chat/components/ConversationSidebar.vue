<script setup lang="ts">
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  MessageSquare,
  Shirt,
  SquarePen,
} from '@lucide/vue';
import { useRouter } from 'vue-router';
import { ref } from 'vue';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { auth } from '@/lib/auth';
import type { Conversation } from '@/api/types/chat';

defineProps<{
  activeConversationId: number | null;
  conversations: Conversation[];
}>();

const emit = defineEmits<{
  (event: 'new'): void;
  (event: 'select', conversationId: number): void;
}>();

const router = useRouter();
const isCollapsed = ref(false);

function signOut() {
  auth.signOut();
  void router.push('/login');
}

function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value;
}
</script>

<template>
  <aside
    :class="
      cn(
        'flex max-h-[45vh] w-full shrink-0 flex-col border-b border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] sm:h-auto sm:max-h-none sm:border-b-0 sm:border-r',
        isCollapsed ? 'sm:w-16' : 'sm:w-72',
      )
    "
  >
    <div
      :class="
        cn(
          'flex items-center px-3 py-3',
          isCollapsed ? 'justify-center' : 'justify-between',
        )
      "
    >
      <RouterLink
        v-if="!isCollapsed"
        class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition-colors hover:bg-sidebar-accent"
        to="/chat"
        title="衣橱指南"
      >
        <span
          class="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"
        >
          <Shirt aria-hidden="true" />
        </span>
        <span class="truncate">衣橱指南</span>
      </RouterLink>
      <div class="flex items-center gap-0.5">
        <Button
          :aria-label="isCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          :title="isCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          size="icon"
          type="button"
          variant="ghost"
          @click="toggleCollapsed"
        >
          <ChevronRight v-if="isCollapsed" aria-hidden="true" />
          <ChevronLeft v-else aria-hidden="true" />
        </Button>
      </div>
    </div>

    <div :class="cn('px-3 pb-3', isCollapsed && 'flex justify-center px-2')">
      <Button
        :aria-label="isCollapsed ? '新聊天' : undefined"
        :title="isCollapsed ? '新聊天' : undefined"
        :class="isCollapsed ? 'size-10 px-0' : 'w-full justify-start gap-2'"
        type="button"
        variant="secondary"
        @click="emit('new')"
      >
        <SquarePen
          aria-hidden="true"
          :data-icon="isCollapsed ? undefined : 'inline-start'"
        />
        <span v-if="!isCollapsed">新聊天</span>
      </Button>
    </div>

    <Separator class="bg-sidebar-border" />

    <ScrollArea
      :class="cn('min-h-0 flex-1 py-4', isCollapsed ? 'px-2' : 'px-3')"
    >
      <div class="flex flex-col gap-2">
        <p
          v-if="!isCollapsed"
          class="px-2 text-xs font-medium text-muted-foreground"
        >
          最近
        </p>
        <button
          v-for="conversation in conversations"
          :key="conversation.id"
          :aria-label="conversation.title"
          :aria-current="
            conversation.id === activeConversationId ? 'page' : undefined
          "
          :title="conversation.title"
          :class="
            cn(
              'flex w-full items-center gap-2 rounded-md py-2 text-left text-sm transition-colors',
              isCollapsed ? 'justify-center px-0' : 'px-2',
              conversation.id === activeConversationId
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
            )
          "
          type="button"
          @click="emit('select', conversation.id)"
        >
          <MessageSquare aria-hidden="true" class="shrink-0" />
          <span v-if="!isCollapsed" class="truncate">{{
            conversation.title
          }}</span>
        </button>
      </div>
    </ScrollArea>

    <Separator class="bg-sidebar-border" />

    <div
      :class="cn('flex flex-col gap-1 p-3', isCollapsed && 'items-center px-2')"
    >
      <RouterLink
        :aria-label="auth.state.user?.displayName ?? '我的账户'"
        :title="auth.state.user?.displayName ?? '我的账户'"
        :class="
          cn(
            'flex items-center gap-2 rounded-md py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isCollapsed ? 'justify-center px-0' : 'px-2',
          )
        "
        to="/account"
      >
        <span
          class="flex size-6 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground"
        >
          {{ auth.state.user?.displayName?.slice(0, 1) ?? '我' }}
        </span>
        <span v-if="!isCollapsed" class="min-w-0 flex-1 truncate">{{
          auth.state.user?.displayName ?? '我的账户'
        }}</span>
      </RouterLink>
      <Button
        :aria-label="isCollapsed ? '退出登录' : undefined"
        :title="isCollapsed ? '退出登录' : undefined"
        :class="
          cn(
            'text-muted-foreground',
            isCollapsed ? 'size-10 px-0' : 'w-full justify-start gap-2',
          )
        "
        type="button"
        variant="ghost"
        @click="signOut"
      >
        <LogOut
          aria-hidden="true"
          :data-icon="isCollapsed ? undefined : 'inline-start'"
        />
        <span v-if="!isCollapsed">退出登录</span>
      </Button>
    </div>
  </aside>
</template>
