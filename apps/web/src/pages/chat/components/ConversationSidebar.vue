<script setup lang="ts">
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  MessageSquare,
  Shirt,
  SquarePen,
  Trash2,
} from '@lucide/vue';
import { useRouter } from 'vue-router';
import { ref } from 'vue';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { auth } from '@/lib/auth';
import type { Conversation } from '@/api/types/chat';

defineProps<{
  activeConversationId: string | null;
  conversations: Conversation[];
  conversationListError: string;
  conversationListStatus: 'loading' | 'success' | 'empty' | 'error';
  isLoadingMoreConversations: boolean;
  deletingConversationId: string | null;
  canDeleteConversations: boolean;
}>();

const emit = defineEmits<{
  (event: 'new'): void;
  (event: 'select', conversationId: string): void;
  (event: 'delete', conversationId: string): void;
  (event: 'load-more'): void;
  (event: 'retry'): void;
}>();

const router = useRouter();
const isCollapsed = ref(false);
const isDeleteDialogOpen = ref(false);
const conversationPendingDelete = ref<Conversation | null>(null);

function openDeleteDialog(conversation: Conversation) {
  conversationPendingDelete.value = conversation;
  isDeleteDialogOpen.value = true;
}

function confirmDelete() {
  if (!conversationPendingDelete.value) return;
  emit('delete', conversationPendingDelete.value.id);
  conversationPendingDelete.value = null;
}

function signOut() {
  auth.signOut();
  void router.push('/login');
}

function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value;
}

function getConversationMark(title: string): string {
  return Array.from(title.trim()).slice(0, 2).join('') || '聊';
}

// 只在列表可滚动且接近底部时请求下一页，避免短列表自动连续加载。
function handleConversationScroll(event: Event) {
  const viewport = event.currentTarget;
  if (!(viewport instanceof HTMLElement)) return;

  const remainingScroll =
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  if (viewport.scrollHeight <= viewport.clientHeight || remainingScroll > 80) {
    return;
  }

  emit('load-more');
}
</script>

<template>
  <aside
    :class="
      cn(
        'flex max-h-[45vh] w-full shrink-0 flex-col border-b border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] sm:h-full sm:max-h-none sm:border-b-0 sm:border-r',
        isCollapsed ? 'sm:w-16' : 'sm:w-80',
      )
    "
  >
    <div
      :class="
        cn(
          'flex min-h-16 items-center px-4 py-3',
          isCollapsed ? 'justify-center' : 'justify-between',
        )
      "
    >
      <RouterLink
        v-if="!isCollapsed"
        class="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors hover:bg-sidebar-accent"
        to="/chat"
        title="衣橱指南"
      >
        <span
          class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
        >
          <Shirt aria-hidden="true" />
        </span>
        <span class="truncate">衣橱指南</span>
      </RouterLink>
      <div class="flex items-center gap-0.5">
        <Button
          :aria-label="isCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          :title="isCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          class="size-8"
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

    <div :class="cn('px-4 pb-4', isCollapsed && 'flex justify-center px-2')">
      <Button
        :aria-label="isCollapsed ? '新聊天' : undefined"
        :title="isCollapsed ? '新聊天' : undefined"
        :class="
          isCollapsed
            ? 'size-10 rounded-lg px-0'
            : 'h-10 w-full justify-start gap-2 rounded-lg text-xs'
        "
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
      :class="cn('min-h-0 flex-1 py-4', isCollapsed ? 'px-2' : 'px-4')"
      @scroll="handleConversationScroll"
    >
      <div class="flex flex-col gap-1.5">
        <p
          v-if="!isCollapsed"
          class="px-2 pb-2 text-xs font-medium text-muted-foreground"
        >
          最近
        </p>
        <div
          v-for="conversation in conversations"
          :key="conversation.id"
          class="group flex min-w-0 items-center gap-1"
        >
          <button
            :aria-label="conversation.title"
            :aria-current="
              conversation.id === activeConversationId ? 'page' : undefined
            "
            :title="conversation.title"
            :class="
              cn(
                'flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors',
                isCollapsed ? 'justify-center px-0' : 'px-2',
                conversation.id === activeConversationId
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
              )
            "
            type="button"
            @click="emit('select', conversation.id)"
          >
            <MessageSquare
              v-if="!isCollapsed"
              aria-hidden="true"
              class="size-[18px] shrink-0"
            />
            <span
              v-else
              aria-hidden="true"
              class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-current/15 bg-background/70 text-[10px] font-semibold leading-none"
            >
              {{ getConversationMark(conversation.title) }}
            </span>
            <span v-if="!isCollapsed" class="truncate">{{
              conversation.title
            }}</span>
          </button>
          <Button
            v-if="!isCollapsed"
            :aria-label="`删除会话：${conversation.title}`"
            :disabled="
              !canDeleteConversations ||
              deletingConversationId === conversation.id
            "
            :title="
              deletingConversationId === conversation.id
                ? '正在删除'
                : '删除会话'
            "
            :class="
              cn(
                'size-8 shrink-0 rounded-lg text-muted-foreground transition-opacity focus-visible:opacity-100',
                conversation.id === activeConversationId
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100',
              )
            "
            size="icon"
            type="button"
            variant="ghost"
            @click="openDeleteDialog(conversation)"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
        <p
          v-if="!isCollapsed && conversationListStatus === 'loading'"
          class="px-2 py-2 text-xs text-muted-foreground"
          role="status"
        >
          正在加载会话…
        </p>
        <div
          v-if="!isCollapsed && conversationListStatus === 'empty'"
          class="px-2 py-2 text-xs text-muted-foreground"
        >
          暂无历史会话
        </div>
        <div
          v-if="!isCollapsed && conversationListStatus === 'error'"
          class="flex flex-col items-start gap-2 px-2 py-2 text-xs text-destructive"
          role="alert"
        >
          <span>{{ conversationListError }}</span>
          <Button
            class="h-7 px-2"
            size="sm"
            type="button"
            variant="outline"
            @click="emit('retry')"
          >
            重试
          </Button>
        </div>
        <p
          v-if="
            !isCollapsed &&
            conversationListError &&
            conversationListStatus !== 'error'
          "
          class="px-2 py-2 text-xs text-destructive"
          role="alert"
        >
          {{ conversationListError }}
        </p>
        <p
          v-if="!isCollapsed && isLoadingMoreConversations"
          class="px-2 py-2 text-xs text-muted-foreground"
          role="status"
        >
          正在加载更多…
        </p>
      </div>
    </ScrollArea>

    <Separator class="bg-sidebar-border" />

    <div
      :class="cn('flex flex-col gap-1 p-4', isCollapsed && 'items-center px-2')"
    >
      <RouterLink
        :aria-label="auth.state.user?.displayName ?? '我的账户'"
        :title="auth.state.user?.displayName ?? '我的账户'"
        :class="
          cn(
            'flex items-center gap-3 rounded-lg px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isCollapsed ? 'justify-center px-0' : 'px-2',
          )
        "
        to="/account"
      >
        <span
          class="flex size-7 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground"
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
            isCollapsed
              ? 'size-10 rounded-lg px-0'
              : 'h-10 w-full justify-start gap-3 rounded-lg px-2 text-xs',
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

    <AlertDialog v-model:open="isDeleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除这段对话？</AlertDialogTitle>
          <AlertDialogDescription class="break-words">
            确定删除“{{
              conversationPendingDelete?.title
            }}”及其聊天记录吗？此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            :disabled="!canDeleteConversations"
            variant="destructive"
            @click="confirmDelete"
          >
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </aside>
</template>
