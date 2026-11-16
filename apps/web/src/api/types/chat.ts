import type { PurchaseReference } from './chat-purchase';
import type {
  ChatDynamicForm,
  ChatDynamicFormReference,
  ChatDynamicFormResult,
} from './chat-dynamic-form';
import type { PreferenceCategory } from './preferences';

export type MessageRole = 'assistant' | 'user';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ChatActivity =
  | {
      type: 'tool';
      id: string;
      toolName: string;
      status: 'running' | 'success' | 'error' | 'interrupted';
      input: JsonValue;
      output: string | null;
    }
  | { type: 'reasoning'; id: string; summary: string };

export type ChatSource = { id: string; title: string; url: string };

export interface OrderCancellationCandidate {
  orderId: string;
  orderNo: string;
  status: 'pending_payment';
  payableAmount: string;
  createdAt: string;
  expiresAt: string;
  cancelable: true;
  items: Array<{
    productName: string;
    color: string;
    size: string;
    quantity: number;
  }>;
}

export type ChatOrderCancellationCandidate = OrderCancellationCandidate & {
  cancellationResult?: 'cancelled';
};

export type ChatProductCard = {
  externalId: string;
  name: string;
  brand: string | null;
  category: 'tops' | 'bottoms' | 'dresses' | 'outerwear' | 'shoes';
  description: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  price: string;
  currency: 'CNY';
  sizes: string[];
  colors: string[];
  inStock: boolean;
  tryOnEnabled: boolean;
  matchReasons: string[];
};

export type ChatOrderCardItem = {
  productName: string;
  color: string;
  size: string;
  quantity: number;
};

export type ChatOrderCardSummary = {
  orderNo: string;
  status:
    | 'pending_payment'
    | 'pending_shipment'
    | 'pending_receipt'
    | 'completed'
    | 'closed';
  closeReason:
    'user_cancelled' | 'payment_expired' | 'product_unavailable' | null;
  itemsAmount: string;
  payableAmount: string;
  itemCount: number;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  items: ChatOrderCardItem[];
};

export type ChatAddressSelectionCard = {
  draftId: string;
  draftVersion: number;
};

export type ChatAddressSelectionActionStatus =
  | 'idle'
  | 'submitting'
  | 'success'
  | 'stale'
  | 'conflict'
  | 'unknown'
  | 'error';

export type ChatAddressSelectionRequest = ChatAddressSelectionCard & {
  addressId: string;
  conversationId: string;
};

export type ChatCard =
  | {
      type: 'card';
      name: 'product';
      data: { items: ChatProductCard[] };
    }
  | {
      type: 'card';
      name: 'order';
      data: { items: ChatOrderCardSummary[] };
    }
  | {
      type: 'card';
      name: 'address_selection';
      data: ChatAddressSelectionCard;
    };

export type ChatProductResults = {
  items: ChatProductCard[];
  nextCursor: string | null;
  noResultReason:
    | 'NO_MATCHING_SIZE'
    | 'OVER_BUDGET'
    | 'OUT_OF_STOCK'
    | 'NO_MATCHING_PRODUCT'
    | null;
  query?: ProductSearchQuery;
  loadingMore?: boolean;
  loadMoreError?: string;
};

export type ChatTryOnAction = {
  productExternalId: string;
  color: string;
  photoId: string;
  consentVersion: string;
};

export type ChatTryOnResult = {
  taskId: string;
  product: {
    externalId: string;
    name: string;
    color: string;
  };
  result: {
    width: number;
    height: number;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  };
};

export type ChatTryOnStatus =
  | { status: 'queued' | 'processing'; taskId: string }
  | {
      status: 'failed' | 'timed_out';
      taskId?: string;
      code: string;
    };

export type ProductSearchQuery = {
  category?: ChatProductCard['category'];
  size?: string;
  color?: string;
  style?: string;
  occasion?: string;
  fit?: string;
  budgetMin?: number;
  budgetMax?: number;
  inStock?: boolean;
  limit: 3;
};

export type ChatContextUsage = {
  contextWindowTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usedTokens: number | null;
};

export type ChatTurnStatus =
  'submitted' | 'streaming' | 'saved' | 'failed' | 'interrupted' | 'uncertain';

export interface ChatMessage {
  id: string;
  /** 保存后沿用临时消息的 DOM，避免服务器 ID 替换触发滚动跳转。 */
  renderKey?: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  /** AI 回复生成耗时，仅前端当前会话展示。 */
  duration?: string;
  activities: ChatActivity[];
  sources: ChatSource[];
  cards: ChatCard[];
  productResults: ChatProductResults[];
  orderCancellationCandidates: ChatOrderCancellationCandidate[];
  context: ChatContextUsage | null;
  purchase: PurchaseReference | null;
  tryOnResult: ChatTryOnResult | null;
  tryOnStatus: ChatTryOnStatus | null;
  forms: ChatDynamicForm[];
  status: ChatTurnStatus;
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
}

export interface ChatApiMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  createdAt: string;
  activities?: ChatActivity[];
  sources?: ChatSource[];
  cards?: ChatCard[];
  productResults?: ChatProductResults[];
  orderCancellationCandidates?: OrderCancellationCandidate[];
  context?: ChatContextUsage | null;
  purchase?: PurchaseReference | null;
  tryOnResult?: ChatTryOnResult | null;
  tryOnStatus?: ChatTryOnStatus | null;
  forms?: ChatDynamicFormReference[];
}

export interface ChatApiConversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ChatConversationDetail extends ChatApiConversation {
  messages: PageResponse<ChatApiMessage>;
}

export interface ChatRequestMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatRequestMessage[];
  conversationId?: string;
  tryOnAction?: ChatTryOnAction;
}

export type ChatStreamEvent =
  | {
      type: 'start';
      conversationId: string;
      title: string;
      contextWindowTokens?: number;
    }
  | {
      type: 'delta';
      content: string;
    }
  | {
      type: 'done';
      conversationId: string;
      title: string;
      model: string;
      usage: {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
      } | null;
      context?: ChatContextUsage | null;
      tryOnResult?: ChatTryOnResult;
      tryOnStatus?: Extract<
        ChatTryOnStatus,
        { status: 'failed' | 'timed_out' }
      >;
    }
  | { type: 'activity'; activity: ChatActivity }
  | {
      type: 'try-on-status';
      status: Extract<ChatTryOnStatus, { status: 'queued' | 'processing' }>;
    }
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'card'; card: ChatCard }
  | {
      type: 'product-results';
      results: ChatProductResults;
      activity: Extract<ChatActivity, { type: 'tool' }>;
    }
  | {
      type: 'order-cancellation-candidates';
      orderCancellationCandidates: OrderCancellationCandidate[];
    }
  | { type: 'purchase'; purchase: PurchaseReference | null }
  | { type: 'purchase-form' }
  | { type: 'preference-form'; category?: PreferenceCategory }
  | { type: 'address-form' }
  | { type: 'form'; form: ChatDynamicForm }
  | { type: 'form-result'; result: ChatDynamicFormResult }
  | {
      type: 'error';
      message: string;
    };
