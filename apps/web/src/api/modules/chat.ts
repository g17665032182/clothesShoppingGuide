import { ApiError, apiRequest, apiStreamRequest } from '@/api';
import type {
  ChatApiConversation,
  ChatActivity,
  ChatContextUsage,
  ChatConversationDetail,
  OrderCancellationCandidate,
  ChatProductResults,
  ChatRequest,
  ChatStreamEvent,
  ChatSource,
  JsonValue,
  PageResponse,
} from '@/api/types/chat';
import type { PurchaseReference } from '@/api/types/chat-purchase';

const conversationPageSize = 10;
const messagePageSize = 100;

export function listConversations(
  token: string,
  page = 1,
  signal?: AbortSignal,
): Promise<PageResponse<ChatApiConversation>> {
  return apiRequest<PageResponse<ChatApiConversation>>(
    `/chat/conversations?page=${page}&pageSize=${conversationPageSize}`,
    { token, signal },
  );
}

export async function getConversation(
  token: string,
  conversationId: string,
  page = 1,
  signal?: AbortSignal,
): Promise<ChatConversationDetail> {
  const detail = await apiRequest<ChatConversationDetail>(
    `/chat/conversations/${conversationId}?page=${page}&pageSize=${messagePageSize}`,
    { token, signal },
  );
  // 旧记录或无效展示元数据不能影响正文读取，也不能以断言绕过边界校验。
  return {
    ...detail,
    messages: {
      ...detail.messages,
      items: detail.messages.items.map((message) => ({
        ...message,
        activities: isActivities(message.activities) ? message.activities : [],
        sources: isSources(message.sources) ? message.sources : [],
        productResults: isProductResults(message.productResults)
          ? message.productResults
          : [],
        orderCancellationCandidates: isOrderCancellationCandidates(
          message.orderCancellationCandidates,
        )
          ? message.orderCancellationCandidates
          : [],
        context: isContext(message.context) ? message.context : null,
      })),
    },
  };
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

export function parseEventFrame(frame: string): ChatStreamEvent | null {
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
  if (
    ![
      'start',
      'delta',
      'activity',
      'sources',
      'product-results',
      'order-cancellation-candidates',
      'purchase',
      'done',
      'error',
    ].includes(eventName)
  )
    return null;

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
    if (
      data.contextWindowTokens !== undefined &&
      !isPositiveInteger(data.contextWindowTokens)
    ) {
      throw new ApiError('聊天流窗口数据无效', 0);
    }
    return {
      type: 'start',
      conversationId: data.conversationId,
      title: data.title,
      ...(data.contextWindowTokens === undefined
        ? {}
        : { contextWindowTokens: data.contextWindowTokens as number }),
    };
  }
  if (eventName === 'activity' && isRecord(data) && isActivity(data.activity)) {
    return { type: 'activity', activity: data.activity };
  }
  if (eventName === 'sources' && isRecord(data) && isSources(data.sources)) {
    return { type: 'sources', sources: data.sources };
  }
  if (
    eventName === 'purchase' &&
    isRecord(data) &&
    (data.purchase === null ||
      isPurchaseReference(data.purchase) ||
      isPurchaseReference(data))
  ) {
    return {
      type: 'purchase',
      purchase: isPurchaseReference(data)
        ? data
        : (data.purchase as PurchaseReference | null),
    };
  }
  if (
    eventName === 'product-results' &&
    isRecord(data) &&
    isProductResults([data.results]) &&
    isToolActivity(data.activity)
  ) {
    return {
      type: 'product-results',
      results: data.results as ChatProductResults,
      activity: data.activity,
    };
  }
  if (
    eventName === 'order-cancellation-candidates' &&
    isRecord(data) &&
    isOrderCancellationCandidates(data.orderCancellationCandidates)
  ) {
    return {
      type: 'order-cancellation-candidates',
      orderCancellationCandidates: data.orderCancellationCandidates,
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
    if (
      data.context !== undefined &&
      data.context !== null &&
      !isContext(data.context)
    ) {
      throw new ApiError('聊天流上下文用量无效', 0);
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
              inputTokens: data.usage.inputTokens,
              outputTokens: data.usage.outputTokens,
              totalTokens: data.usage.totalTokens,
            },
      context: isContext(data.context) ? data.context : null,
    };
  }
  if (eventName === 'error' && isRecord(data)) {
    if (!hasString(data, 'message')) {
      throw new ApiError('聊天流 error 事件格式无效', 0);
    }
    return { type: 'error', message: data.message };
  }
  throw new ApiError(`聊天流 ${eventName} 事件格式无效`, 0);
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
    await response.stream.cancel().catch(() => undefined);
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
        if (event.type === 'done' || event.type === 'error') completed = true;
        yield event;
        if (completed) return;
      }
      if (done) break;
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseEventFrame(buffer);
      if (event) {
        if (event.type === 'done' || event.type === 'error') completed = true;
        yield event;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  if (!completed && !signal.aborted) {
    throw new ApiError('聊天流意外结束', 0);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPurchaseReference(value: unknown): value is PurchaseReference {
  if (!isRecord(value)) return false;
  const version = value.version;
  return (
    typeof value.draftId === 'string' &&
    typeof version === 'number' &&
    Number.isSafeInteger(version) &&
    version > 0 &&
    (value.orderId === null || typeof value.orderId === 'string')
  );
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
    (key) => value[key] === null || isTokenNumber(value[key]),
  );
}

function isTokenNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isTokenNumber(value) && value > 0;
}

function isContext(value: unknown): value is ChatContextUsage {
  if (!isRecord(value) || !isPositiveInteger(value.contextWindowTokens))
    return false;
  if (
    !['inputTokens', 'outputTokens', 'usedTokens'].every(
      (key) => value[key] === null || isTokenNumber(value[key]),
    )
  )
    return false;
  return value.inputTokens !== null && value.outputTokens !== null
    ? value.usedTokens ===
        Number(value.inputTokens) + Number(value.outputTokens)
    : value.usedTokens === null;
}

function isProductResults(value: unknown): value is ChatProductResults[] {
  if (!Array.isArray(value)) return false;
  return value.every((result) => {
    if (
      !isRecord(result) ||
      !Array.isArray(result.items) ||
      result.items.length > 20 ||
      (result.nextCursor !== null && typeof result.nextCursor !== 'string') ||
      ![
        null,
        'NO_MATCHING_SIZE',
        'OVER_BUDGET',
        'OUT_OF_STOCK',
        'NO_MATCHING_PRODUCT',
      ].includes(result.noResultReason as null | string)
    )
      return false;
    if (result.query !== undefined && !isProductSearchQuery(result.query))
      return false;
    return result.items.every((item) => {
      if (
        !isRecord(item) ||
        !hasString(item, 'externalId') ||
        !hasString(item, 'name') ||
        !hasString(item, 'category') ||
        !['tops', 'bottoms', 'dresses', 'outerwear', 'shoes'].includes(
          item.category,
        ) ||
        !(item.brand === null || typeof item.brand === 'string') ||
        !(item.description === null || typeof item.description === 'string') ||
        !(item.imageUrl === null || typeof item.imageUrl === 'string') ||
        !(item.productUrl === null || typeof item.productUrl === 'string') ||
        !hasString(item, 'price') ||
        !/^\d{1,10}\.\d{2}$/u.test(item.price) ||
        item.currency !== 'CNY' ||
        !Array.isArray(item.sizes) ||
        !item.sizes.every((size) => typeof size === 'string') ||
        !Array.isArray(item.colors) ||
        !item.colors.every((color) => typeof color === 'string') ||
        typeof item.inStock !== 'boolean' ||
        !Array.isArray(item.matchReasons) ||
        !item.matchReasons.every((reason) => typeof reason === 'string')
      )
        return false;
      return true;
    });
  });
}

function isProductSearchQuery(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set([
    'category',
    'size',
    'color',
    'style',
    'occasion',
    'fit',
    'budgetMin',
    'budgetMax',
    'inStock',
    'limit',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (!Number.isInteger(value.limit) || value.limit !== 3) return false;
  if (
    value.category !== undefined &&
    !['tops', 'bottoms', 'dresses', 'outerwear', 'shoes'].includes(
      String(value.category),
    )
  )
    return false;
  if (
    ['size', 'color', 'style', 'occasion', 'fit'].some(
      (key) =>
        value[key] !== undefined &&
        (typeof value[key] !== 'string' ||
          value[key].trim().length === 0 ||
          value[key].length > 32),
    )
  )
    return false;
  if (
    ['budgetMin', 'budgetMax'].some(
      (key) =>
        value[key] !== undefined &&
        (typeof value[key] !== 'number' ||
          !Number.isFinite(value[key]) ||
          value[key] < 0 ||
          value[key] > 9_999_999_999.99),
    )
  )
    return false;
  return value.inStock === undefined || typeof value.inStock === 'boolean';
}

function isJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return value.every((item) => isJson(item, depth + 1));
  return (
    isRecord(value) &&
    Object.values(value).every((item) => isJson(item, depth + 1))
  );
}

function isActivity(value: unknown): value is ChatActivity {
  if (!isRecord(value) || !hasString(value, 'id') || !value.id) return false;
  if (value.type === 'reasoning')
    return hasString(value, 'summary') && Boolean(value.summary.trim());
  return (
    value.type === 'tool' &&
    hasString(value, 'toolName') &&
    Boolean(value.toolName.trim()) &&
    ['running', 'success', 'error', 'interrupted'].includes(
      String(value.status),
    ) &&
    isJson(value.input) &&
    (value.output === null || typeof value.output === 'string')
  );
}

function isToolActivity(
  value: unknown,
): value is Extract<ChatActivity, { type: 'tool' }> {
  return isActivity(value) && value.type === 'tool';
}

function isActivities(value: unknown): value is ChatActivity[] {
  return (
    Array.isArray(value) &&
    value.every(isActivity) &&
    new Set(value.map((item) => item.id)).size === value.length
  );
}

function isSources(value: unknown): value is ChatSource[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  const urls = new Set<string>();
  return value.every((item) => {
    if (
      !isRecord(item) ||
      !hasString(item, 'id') ||
      !item.id ||
      !hasString(item, 'title') ||
      !item.title.trim() ||
      !hasString(item, 'url')
    )
      return false;
    try {
      const url = new URL(item.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        !url.hostname ||
        ids.has(item.id) ||
        urls.has(url.href)
      )
        return false;
      ids.add(item.id);
      urls.add(url.href);
      return true;
    } catch {
      return false;
    }
  });
}

function isOrderCancellationCandidates(
  value: unknown,
): value is OrderCancellationCandidate[] {
  if (!Array.isArray(value) || value.length > 5) return false;
  const orderIds = new Set<string>();
  return value.every((candidate) => {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).some(
        (key) =>
          ![
            'orderId',
            'orderNo',
            'status',
            'payableAmount',
            'createdAt',
            'expiresAt',
            'cancelable',
            'items',
          ].includes(key),
      ) ||
      !hasString(candidate, 'orderId') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        candidate.orderId,
      ) ||
      orderIds.has(candidate.orderId) ||
      !hasString(candidate, 'orderNo') ||
      !candidate.orderNo.trim() ||
      candidate.orderNo.length > 100 ||
      candidate.status !== 'pending_payment' ||
      !hasString(candidate, 'payableAmount') ||
      !/^\d{1,10}\.\d{2}$/u.test(candidate.payableAmount) ||
      !hasString(candidate, 'createdAt') ||
      !isIsoDateTime(candidate.createdAt) ||
      !hasString(candidate, 'expiresAt') ||
      !isIsoDateTime(candidate.expiresAt) ||
      !Object.is(candidate.cancelable, true) ||
      !Array.isArray(candidate.items) ||
      candidate.items.length > 5
    )
      return false;
    orderIds.add(candidate.orderId);
    return candidate.items.every(
      (item) =>
        isRecord(item) &&
        Object.keys(item).every((key) =>
          ['productName', 'color', 'size', 'quantity'].includes(key),
        ) &&
        hasString(item, 'productName') &&
        item.productName.length <= 60 &&
        hasString(item, 'color') &&
        item.color.length <= 16 &&
        hasString(item, 'size') &&
        item.size.length <= 16 &&
        typeof item.quantity === 'number' &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 999,
    );
  });
}

function isIsoDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value))
  );
}
