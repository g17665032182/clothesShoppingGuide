export const CHAT_EXTRACTION_SOURCE = Symbol('CHAT_EXTRACTION_SOURCE');

export type ChatExtractionInput = {
  userId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
};

export interface ChatExtractionSource {
  readTurn(input: ChatExtractionInput): Promise<{
    userMessage: string;
    assistantMessage: string;
  } | null>;
}
