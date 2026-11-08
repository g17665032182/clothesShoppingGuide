export const CHAT_EXTRACTION_SOURCE = Symbol('CHAT_EXTRACTION_SOURCE');

export type ChatExtractionInput = {
  userId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
};

export type ChatExtractionTurn = {
  userMessageId: string;
  assistantMessageId: string;
};

export type ChatExtractionSourceTurn = ChatExtractionTurn & {
  userMessage: string;
  assistantMessage: string;
};

export interface ChatExtractionSource {
  ownsConversation?(input: {
    userId: string;
    conversationId: string;
  }): Promise<boolean>;
  readTurn(input: ChatExtractionInput): Promise<{
    userMessageId: string;
    assistantMessageId: string;
    userMessage: string;
    assistantMessage: string;
  } | null>;
  readTurns?(input: {
    userId: string;
    conversationId: string;
    turns: ChatExtractionTurn[];
  }): Promise<ChatExtractionSourceTurn[] | null>;
}
