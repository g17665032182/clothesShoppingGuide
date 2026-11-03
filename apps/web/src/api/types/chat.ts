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
      type: 'error';
      message: string;
    };
