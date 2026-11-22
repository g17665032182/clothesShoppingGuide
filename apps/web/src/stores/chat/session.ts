import type { ChatMessage } from '@/api/types/chat';
import type { PurchaseDraft } from '@/api/types/chat-purchase';
import type { OrderDetail } from '@/api/types/orders';
import type { PreferenceCategory } from '@/api/types/preferences';

export type ChatPageStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'success'
  | 'empty'
  | 'error'
  | 'unknown';

export type PurchaseAsyncStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'empty'
  | 'error'
  | 'submitting'
  | 'unknown';

export interface ChatPurchaseState {
  status: PurchaseAsyncStatus;
  draft: PurchaseDraft | null;
  order: OrderDetail | null;
  errorMessage: string;
  requestVersion: number;
  autoPromptedStartKeys: string[];
  openFormRequested: boolean;
}

export interface ChatPreferenceFormRequest {
  requestId: string;
  category?: PreferenceCategory;
  identityVersion: number;
  userId: string;
}

export interface ChatAddressFormRequest {
  requestId: string;
  identityVersion: number;
  userId: string;
}

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
  purchase: ChatPurchaseState;
  preferenceFormRequest: ChatPreferenceFormRequest | null;
  addressFormRequest: ChatAddressFormRequest | null;
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
    purchase: {
      status: 'idle',
      draft: null,
      order: null,
      errorMessage: '',
      requestVersion: 0,
      autoPromptedStartKeys: [],
      openFormRequested: false,
    },
    preferenceFormRequest: null,
    addressFormRequest: null,
  };
}
