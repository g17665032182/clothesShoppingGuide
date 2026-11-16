import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';

export type ChatTraceEventLike = {
  runId?: string;
  eventType: 'input' | 'model_response' | 'tool_call' | 'tool_result';
  sequence: number;
  messageId?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  content?: string | null;
  payload?: unknown;
  status?: 'success' | 'failed' | 'partial' | null;
  model?: string | null;
  usage?: unknown;
};

export type ChatHistoryMessage = {
  id: string;
  runId?: string;
  message: BaseMessage;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const PURCHASE_TOOL_NAMES = new Set([
  'get_purchase_draft',
  'update_purchase_draft',
  'discard_purchase_draft',
]);
const DYNAMIC_FORM_TOOL_NAMES = new Set(['request_dynamic_form']);
const HIDDEN_USER_INFORMATION_TOOL_NAMES = new Set([
  'get_my_information',
  'get_product_skus',
  'get_my_preferences',
  'list_my_shipping_addresses',
  'select_my_shipping_address',
]);

function isPurchaseTool(name: string): boolean {
  return PURCHASE_TOOL_NAMES.has(name);
}

function isHiddenTool(name: string): boolean {
  return (
    isPurchaseTool(name) ||
    DYNAMIC_FORM_TOOL_NAMES.has(name) ||
    HIDDEN_USER_INFORMATION_TOOL_NAMES.has(name)
  );
}

function payloadToolCalls(payload: unknown): Array<{
  id: string;
  name: string;
  args: Record<string, unknown>;
}> {
  const record = asRecord(payload);
  const value = record.toolCalls ?? record.tool_calls;
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const call = asRecord(item);
    const id = asString(call.id);
    const name = asString(call.name);
    const args = asRecord(call.args ?? call.arguments);
    return id && name && !isHiddenTool(name) ? [{ id, name, args }] : [];
  });
}

function messageContent(event: ChatTraceEventLike): string {
  return event.content ?? '';
}

/**
 * 将内部 trace 事件恢复为 LangChain 消息。
 *
 * 工具调用事件可能和 model_response 分开保存，因此先按 messageId 收集调用，
 * 再构造 AIMessage，避免把 tool_call 事件错误地作为独立文本消息发送给模型。
 */
export function mapTraceEventsToMessages(
  events: ChatTraceEventLike[],
): ChatHistoryMessage[] {
  const sorted = [...events];
  const callsByMessageId = new Map<
    string,
    Array<{ id: string; name: string; args: Record<string, unknown> }>
  >();
  const purchaseCallIds = new Set<string>();

  for (const event of sorted) {
    if (event.eventType === 'model_response') {
      const record = asRecord(event.payload);
      // 非法调用也可能留下结果；所有兼容键都收集隐藏 ID，避免结果失去配对后泄漏。
      for (const key of ['toolCalls', 'tool_calls', 'invalid_tool_calls']) {
        const calls = record[key];
        if (Array.isArray(calls)) {
          for (const item of calls) {
            const call = asRecord(item);
            const id = asString(call.id);
            const name = asString(call.name);
            if (id && name && isHiddenTool(name)) purchaseCallIds.add(id);
          }
        }
      }
    }
    if (event.eventType !== 'tool_call') continue;
    const messageId = event.messageId ?? '';
    const toolCallId = event.toolCallId;
    const toolName = event.toolName;
    if (!toolCallId || !toolName) {
      continue;
    }
    if (isHiddenTool(toolName)) {
      purchaseCallIds.add(toolCallId);
      continue;
    }
    if (!messageId) continue;
    const payload = asRecord(event.payload);
    const args = asRecord(payload.args ?? payload);
    const calls = callsByMessageId.get(messageId) ?? [];
    calls.push({ id: toolCallId, name: toolName, args });
    callsByMessageId.set(messageId, calls);
  }

  const messages: ChatHistoryMessage[] = [];
  for (const event of sorted) {
    if (event.eventType === 'tool_call') {
      continue;
    }

    const id = event.messageId ?? `trace-${event.sequence}`;
    const run = event.runId ? { runId: event.runId } : {};
    if (event.eventType === 'input') {
      messages.push({
        id,
        ...run,
        message: new HumanMessage(messageContent(event)),
      });
      continue;
    }

    if (event.eventType === 'model_response') {
      const toolCalls = [
        ...payloadToolCalls(event.payload),
        ...(callsByMessageId.get(event.messageId ?? '') ?? []),
      ];
      const deduplicated = toolCalls.filter(
        (call, index, all) =>
          all.findIndex((candidate) => candidate.id === call.id) === index,
      );
      if (deduplicated.length === 0 && !messageContent(event)) continue;
      messages.push({
        id,
        ...run,
        message: new AIMessage({
          content: messageContent(event),
          tool_calls: deduplicated,
          ...(event.messageId ? { id: event.messageId } : {}),
          ...(event.model ? { response_metadata: { model: event.model } } : {}),
        }),
      });
      continue;
    }

    if (
      event.eventType === 'tool_result' &&
      event.toolCallId &&
      !purchaseCallIds.has(event.toolCallId) &&
      !isHiddenTool(event.toolName ?? '')
    ) {
      messages.push({
        id,
        ...run,
        message: new ToolMessage({
          content: messageContent(event),
          tool_call_id: event.toolCallId,
          status: event.status === 'failed' ? 'error' : 'success',
          ...(event.toolName ? { name: event.toolName } : {}),
        }),
      });
    }
  }

  return messages;
}

export function mapLegacyMessagesToLangChain(
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
  }>,
): ChatHistoryMessage[] {
  return messages.map((item) => ({
    id: item.id,
    message:
      item.role === 'user'
        ? new HumanMessage({ content: item.content, id: item.id })
        : new AIMessage({ content: item.content, id: item.id }),
  }));
}

export function mapSystemMessagesToLangChain(
  messages: Array<{ content: string }>,
): BaseMessage[] {
  return messages.map((message) => new SystemMessage(message.content));
}
