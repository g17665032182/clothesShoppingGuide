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

export type ChatDisplayData = {
  activities: ChatActivity[];
  sources: ChatSource[];
  context: ChatContextUsage | null;
};

/** 展示消息 ID 独立绑定，保留 trace 自身的 LangChain messageId。 */
export type PublicDisplayEnvelope = ChatDisplayData & {
  version: 1;
  assistantMessageId: string;
};

export type ChatDisplayEvent =
  | { type: 'activity'; activity: ChatActivity }
  | { type: 'sources'; sources: ChatSource[] };
