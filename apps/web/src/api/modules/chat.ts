import { ApiError, apiRequest, apiStreamRequest } from '@/api';
import type {
  ChatApiConversation,
  ChatConversationDetail,
  ChatRequest,
  ChatStreamEvent,
  PageResponse,
} from '@/api/types/chat';

const pageSize = 100;

export function listConversations(
  token: string,
): Promise<PageResponse<ChatApiConversation>> {
  return apiRequest<PageResponse<ChatApiConversation>>(
    `/chat/conversations?page=1&pageSize=${pageSize}`,
    { token },
  );
}

export function getConversation(
  token: string,
  conversationId: string,
): Promise<ChatConversationDetail> {
  return apiRequest<ChatConversationDetail>(
    `/chat/conversations/${conversationId}?page=1&pageSize=${pageSize}`,
    { token },
  );
}

export function deleteConversation(
  token: string,
  conversationId: string,
): Promise<void> {
  return apiRequest<void>(`/chat/conversations/${conversationId}`, {
    method: 'DELETE',
    token,
  });
}

function parseEventFrame(frame: string): ChatStreamEvent | null {
  let eventName = '';
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value =
      separator === -1 ? '' : line.slice(separator + 1).replace(/^ /u, '');
    if (field === 'event') eventName = value;
    if (field === 'data') dataLines.push(value);
  }
  if (!eventName || dataLines.length === 0) return null;
  if (!['start', 'delta', 'done', 'error'].includes(eventName)) return null;

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join('\n')) as unknown;
  } catch {
    throw new ApiError('聊天流协议格式无效', 0);
  }

  if (eventName === 'start' && isRecord(data)) {
    if (!hasString(data, 'conversationId') || !hasString(data, 'title')) {
      throw new ApiError('聊天流 start 事件格式无效', 0);
    }
    return {
      type: 'start',
      conversationId: data.conversationId,
      title: data.title,
    };
  }
  if (eventName === 'delta' && isRecord(data)) {
    if (!hasString(data, 'content')) {
      throw new ApiError('聊天流 delta 事件格式无效', 0);
    }
    return { type: 'delta', content: data.content };
  }
  if (eventName === 'done' && isRecord(data)) {
    if (
      !hasString(data, 'conversationId') ||
      !hasString(data, 'title') ||
      !hasString(data, 'model') ||
      !isUsage(data.usage)
    ) {
      throw new ApiError('聊天流 done 事件格式无效', 0);
    }
    return {
      type: 'done',
      conversationId: data.conversationId,
      title: data.title,
      model: data.model,
      usage:
        data.usage === null
          ? null
          : {
              inputTokens: asNullableNumber(data.usage.inputTokens),
              outputTokens: asNullableNumber(data.usage.outputTokens),
              totalTokens: asNullableNumber(data.usage.totalTokens),
            },
    };
  }
  if (eventName === 'error' && isRecord(data)) {
    if (!hasString(data, 'message')) {
      throw new ApiError('聊天流 error 事件格式无效', 0);
    }
    return { type: 'error', message: data.message };
  }
  return null;
}

export async function* streamChat(
  token: string,
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const response = await apiStreamRequest('/llm/chat/stream', {
    method: 'POST',
    adapter: 'fetch',
    data: request,
    signal,
    token,
    headers: { Accept: 'text/event-stream' },
  });
  if (!response.contentType.toLowerCase().includes('text/event-stream')) {
    throw new ApiError('聊天接口未返回流式响应', 0);
  }

  const reader = response.stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/u);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const event = parseEventFrame(frame);
        if (!event) continue;
        if (event.type === 'done') completed = true;
        yield event;
      }
      if (done) break;
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseEventFrame(buffer);
      if (event) {
        if (event.type === 'done') completed = true;
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!completed && !signal.aborted) {
    throw new ApiError('聊天流意外结束', 0);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasString(
  value: Record<string, unknown>,
  key: string,
): value is Record<string, unknown> & Record<typeof key, string> {
  return typeof value[key] === 'string';
}

function isUsage(value: unknown): value is null | {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return ['inputTokens', 'outputTokens', 'totalTokens'].every(
    (key) =>
      value[key] === null ||
      (typeof value[key] === 'number' && Number.isFinite(value[key])),
  );
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
