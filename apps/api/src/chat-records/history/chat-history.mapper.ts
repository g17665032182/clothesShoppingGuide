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
const PREFERENCE_FORM_TOOL_NAMES = new Set(['request_preference_form']);
const ADDRESS_FORM_TOOL_NAMES = new Set(['request_address_form']);
const SHOPPING_RULES_TOOL_NAME = 'get_shopping_rules';
const WEATHER_FORECAST_TOOL_NAME = 'get_weather_forecast';
const RETURN_REFUND_TOOL_NAMES = new Set([
  'list_my_return_refund_orders',
  'get_my_return_refund_items',
  'create_return_refund_application',
]);
const HIDDEN_USER_INFORMATION_TOOL_NAMES = new Set([
  'get_my_information',
  'get_product_skus',
  'get_my_preferences',
  'get_my_order_fulfillment',
  'list_my_shipping_addresses',
  'select_my_shipping_address',
  ...RETURN_REFUND_TOOL_NAMES,
]);

function isPurchaseTool(name: string): boolean {
  return PURCHASE_TOOL_NAMES.has(name);
}

function isHiddenTool(name: string): boolean {
  return (
    isPurchaseTool(name) ||
    DYNAMIC_FORM_TOOL_NAMES.has(name) ||
    PREFERENCE_FORM_TOOL_NAMES.has(name) ||
    ADDRESS_FORM_TOOL_NAMES.has(name) ||
    name === SHOPPING_RULES_TOOL_NAME ||
    name === WEATHER_FORECAST_TOOL_NAME ||
    HIDDEN_USER_INFORMATION_TOOL_NAMES.has(name)
  );
}

function collectNestedPrivateToolCallIds(
  value: unknown,
  hiddenCallIds: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value)
      collectNestedPrivateToolCallIds(item, hiddenCallIds);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const record = value as UnknownRecord;
  const id = asString(record.id);
  const name = asString(record.name);
  const functionName = asString(asRecord(record.function).name);
  if (
    id &&
    (name === 'request_address_form' ||
      functionName === 'request_address_form' ||
      name === 'get_my_order_fulfillment' ||
      functionName === 'get_my_order_fulfillment' ||
      name === SHOPPING_RULES_TOOL_NAME ||
      functionName === SHOPPING_RULES_TOOL_NAME ||
      name === WEATHER_FORECAST_TOOL_NAME ||
      functionName === WEATHER_FORECAST_TOOL_NAME)
  ) {
    hiddenCallIds.add(id);
  }
  if (
    id &&
    ((name !== null && RETURN_REFUND_TOOL_NAMES.has(name)) ||
      (functionName !== null && RETURN_REFUND_TOOL_NAMES.has(functionName)))
  ) {
    hiddenCallIds.add(id);
  }

  for (const entry of Object.values(record)) {
    collectNestedPrivateToolCallIds(entry, hiddenCallIds);
  }
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
  const hiddenCallIds = new Set<string>();

  for (const event of sorted) {
    if (event.eventType === 'model_response') {
      const record = asRecord(event.payload);
      // 地址导航、履约、规则和天气查询额外识别嵌套及非法调用。
      for (const key of ['toolCalls', 'tool_calls', 'invalid_tool_calls']) {
        const calls = record[key];
        if (!Array.isArray(calls)) continue;
        for (const item of calls) {
          const call = asRecord(item);
          const id = asString(call.id);
          const name = asString(call.name);
          if (id && name && isHiddenTool(name)) hiddenCallIds.add(id);
        }
      }
      collectNestedPrivateToolCallIds(event.payload, hiddenCallIds);
    }
    if (event.eventType !== 'tool_call') continue;
    const messageId = event.messageId ?? '';
    const toolCallId = event.toolCallId;
    const toolName = event.toolName;
    if (!toolCallId || !toolName) {
      continue;
    }
    if (isHiddenTool(toolName)) {
      hiddenCallIds.add(toolCallId);
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
      !hiddenCallIds.has(event.toolCallId) &&
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
