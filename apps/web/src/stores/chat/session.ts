import type { ChatMessage } from '@/api/types/chat';

export type ChatPageStatus =
  'idle' | 'loading' | 'streaming' | 'success' | 'empty' | 'error' | 'unknown';

export interface ChatSession {
  /** 服务端分配会话 ID 前后沿用同一个本地标识，防止后台首轮抢占当前会话。 */
  key: string;
  conversationId: string | null;
  title: string;
  messages: ChatMessage[];
  status: ChatPageStatus;
  errorMessage: string;
  streamDuration: string | null;
  firstLoadedPage: number;
  historyError: string;
  isLoadingEarlierMessages: boolean;
}

export interface PendingTurn {
  assistant: ChatMessage;
  user: ChatMessage;
  knownMessageIds: Set<string>;
}

export function createChatSession(
  key: string,
  conversationId: string | null = null,
  title = '新对话',
): ChatSession {
  return {
    key,
    conversationId,
    title,
    messages: [],
    status: 'idle',
    errorMessage: '',
    streamDuration: null,
    firstLoadedPage: 1,
    historyError: '',
    isLoadingEarlierMessages: false,
  };
}
