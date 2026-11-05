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

export interface ChatExtractionSource {
  ownsConversation?(input: {
    userId: string;
    conversationId: string;
  }): Promise<boolean>;
  readTurn(input: ChatExtractionInput): Promise<{
    userMessage: string;
    assistantMessage: string;
  } | null>;
  readTurns?(input: {
    userId: string;
    conversationId: string;
    turns: ChatExtractionTurn[];
  }): Promise<Array<{
    userMessage: string;
    assistantMessage: string;
  }> | null>;
}
