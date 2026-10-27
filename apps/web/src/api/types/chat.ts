export type MessageRole = 'assistant' | 'user';

export interface ChatMessage {
  id: number;
  role: MessageRole;
  content: string;
  time: string;
}

export interface Conversation {
  id: number;
  title: string;
  preview: string;
  updatedAt: string;
}
