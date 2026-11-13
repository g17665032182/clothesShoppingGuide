import type { ProductSearchQuery } from '../../product-catalog/index.js';

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

export type ChatProductCard = {
  externalId: string;
  name: string;
  brand: string | null;
  category: string;
  description: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  price: string;
  currency: 'CNY';
  sizes: string[];
  colors: string[];
  inStock: boolean;
  tryOnEnabled: boolean;
  matchReasons: string[];
};

export type ChatProductResults = {
  items: ChatProductCard[];
  nextCursor: string | null;
  noResultReason: string | null;
  query?: ProductSearchQuery;
};

export type ChatOrderCardItem = {
  productName: string;
  color: string;
  size: string;
  quantity: number;
};

export type ChatOrderCardSummary = {
  orderNo: string;
  status:
    | 'pending_payment'
    | 'pending_shipment'
    | 'pending_receipt'
    | 'completed'
    | 'closed';
  closeReason:
    'user_cancelled' | 'payment_expired' | 'product_unavailable' | null;
  itemsAmount: string;
  payableAmount: string;
  itemCount: number;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  items: ChatOrderCardItem[];
};

export type ChatCard =
  | {
      type: 'card';
      name: 'product';
      data: { items: ChatProductCard[] };
    }
  | {
      type: 'card';
      name: 'order';
      data: { items: ChatOrderCardSummary[] };
    }
  | {
      type: 'card';
      name: 'address_selection';
      data: { draftId: string; draftVersion: number };
    };

export type ChatCardSelection =
  | { name: 'product'; externalIds: string[] }
  | { name: 'order'; orderNos: string[] };

export type ChatCardSourceRegistry = {
  registerProducts(value: unknown): void;
  registerOrders(value: unknown): void;
  createCard(selection: ChatCardSelection): ChatCard;
};

export type ChatContextUsage = {
  contextWindowTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usedTokens: number | null;
};

export type PurchaseReference = {
  draftId: string;
  version: number;
  orderId: string | null;
};

export type ChatDynamicFormReference = {
  formId: string;
  revision: number;
  formKind: string;
  status: 'open' | 'submitted' | 'expired' | 'cancelled';
};

export type ChatTryOnResult = {
  taskId: string;
  product: {
    externalId: string;
    name: string;
    color: string;
  };
  result: {
    width: number;
    height: number;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  };
};

export type ChatTryOnStatus = {
  status: 'failed' | 'timed_out';
  taskId?: string;
  code: string;
};

export type OrderCancellationCandidate = {
  orderId: string;
  orderNo: string;
  status: 'pending_payment';
  payableAmount: string;
  createdAt: string;
  expiresAt: string;
  cancelable: true;
  items: Array<{
    productName: string;
    color: string;
    size: string;
    quantity: number;
  }>;
};

export type ChatDisplayData = {
  activities: ChatActivity[];
  sources: ChatSource[];
  cards: ChatCard[];
  productResults: ChatProductResults[];
  orderCancellationCandidates: OrderCancellationCandidate[];
  context: ChatContextUsage | null;
  purchase: PurchaseReference | null;
  forms?: ChatDynamicFormReference[];
  tryOnResult?: ChatTryOnResult;
  tryOnStatus?: ChatTryOnStatus;
};

/** 展示消息 ID 独立绑定，保留 trace 自身的 LangChain messageId。 */
export type PublicDisplayEnvelope = ChatDisplayData & {
  version: 1;
  assistantMessageId: string;
};

export type ChatDisplayEvent =
  | { type: 'activity'; activity: ChatActivity }
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'card'; card: ChatCard }
  | { type: 'form'; form: unknown }
  | {
      type: 'order-cancellation-candidates';
      orderCancellationCandidates: OrderCancellationCandidate[];
      activity: Extract<ChatActivity, { type: 'tool' }>;
    }
  | {
      type: 'product-results';
      results: ChatProductResults;
      activity: Extract<ChatActivity, { type: 'tool' }>;
    };
