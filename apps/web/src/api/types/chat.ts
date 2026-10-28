export type MessageRole = 'assistant' | 'user';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  /** AI 回复生成耗时，仅前端当前会话展示。 */
  duration?: string;
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
  role: 'system' | 'user' | 'assistant';
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
    }
  | {
      type: 'error';
      message: string;
    };
