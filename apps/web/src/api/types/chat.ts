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
  matchReasons: string[];
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
  productResults: ChatProductResults[];
  context: ChatContextUsage | null;
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
  productResults?: ChatProductResults[];
  context?: ChatContextUsage | null;
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
    }
  | { type: 'activity'; activity: ChatActivity }
  | { type: 'sources'; sources: ChatSource[] }
  | {
      type: 'product-results';
      results: ChatProductResults;
      activity: Extract<ChatActivity, { type: 'tool' }>;
    }
  | {
      type: 'error';
      message: string;
    };
