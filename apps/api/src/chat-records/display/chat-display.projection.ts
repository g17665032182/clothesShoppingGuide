import { randomUUID } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

import { z } from 'zod';

import type { LlmUsage } from '../../llm/graph/llm.state.js';
import { productSearchQuerySchema } from '../../product-catalog/index.js';
import type {
  ChatActivity,
  ChatCard,
  ChatContextUsage,
  ChatDisplayData,
  OrderCancellationCandidate,
  ChatProductResults,
  ChatSource,
  PurchaseReference,
  PublicDisplayEnvelope,
  ChatCardSelection,
  ChatTryOnResult,
  ChatTryOnStatus,
  ChatDynamicFormReference,
} from './chat-display.types.js';

export const MAX_DISPLAY_BYTES = 16_384;
export const MAX_TRACE_PAYLOAD_BYTES = 32_768;
const BINDING_ID_RESERVATION = '00000000-0000-4000-8000-000000000000';
const PURCHASE_REFERENCE_RESERVATION: PurchaseReference = {
  draftId: BINDING_ID_RESERVATION,
  version: Number.MAX_SAFE_INTEGER,
  orderId: BINDING_ID_RESERVATION,
};
const purchaseReferenceSchema = z.strictObject({
  draftId: z.uuid(),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  orderId: z.uuid().nullable(),
});
const chatTryOnResultSchema = z.strictObject({
  taskId: z.uuid(),
  product: z.strictObject({
    externalId: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(200),
    color: z.string().trim().min(1).max(32),
  }),
  result: z.strictObject({
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  }),
});
const chatTryOnStatusSchema = z.strictObject({
  status: z.enum(['failed', 'timed_out']),
  taskId: z.uuid().optional(),
  code: z.string().regex(/^[A-Z0-9_]{1,80}$/u),
});
const dynamicFormReferenceSchema = z.strictObject({
  formId: z.uuid(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  formKind: z.string().trim().min(1).max(80),
  status: z.enum(['open', 'submitted', 'expired', 'cancelled']),
});
const dynamicFormFieldSchema = z.strictObject({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(100),
  type: z.enum(['text', 'textarea', 'tel', 'number', 'select', 'checkbox']),
  required: z.boolean(),
  placeholder: z.string().trim().max(200).nullable().optional(),
  options: z
    .array(
      z.strictObject({
        value: z.string().trim().min(1).max(160),
        label: z.string().trim().min(1).max(160),
      }),
    )
    .max(50)
    .nullable()
    .optional(),
});
const dynamicFormDefinitionSchema = z.strictObject({
  formId: z.uuid(),
  formKind: z.string().trim().min(1).max(80),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullable(),
  fields: z.array(dynamicFormFieldSchema).min(1).max(20),
  submitLabel: z.string().trim().min(1).max(80),
  status: z.enum(['open', 'submitted', 'expired', 'cancelled']),
  expiresAt: z.iso.datetime({ offset: true }),
});

export function restoreChatTryOnResult(value: unknown): ChatTryOnResult | null {
  const parsed = chatTryOnResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function restoreChatTryOnStatus(value: unknown): ChatTryOnStatus | null {
  const parsed = chatTryOnStatusSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    status: parsed.data.status,
    ...(parsed.data.taskId ? { taskId: parsed.data.taskId } : {}),
    code: parsed.data.code,
  };
}
const orderCancellationCandidateItemSchema = z.strictObject({
  productName: z.string().trim().min(1).max(60),
  color: z.string().max(16),
  size: z.string().max(16),
  quantity: z.number().int().positive().max(999),
});
const orderCancellationCandidateSchema = z.strictObject({
  orderId: z.uuid(),
  orderNo: z.string().trim().min(1).max(100),
  status: z.literal('pending_payment'),
  payableAmount: z.string().regex(/^\d{1,10}\.\d{2}$/u),
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  cancelable: z.literal(true),
  items: z.array(orderCancellationCandidateItemSchema).max(5),
});
const orderCancellationToolCandidateSchema =
  orderCancellationCandidateSchema.extend({
    items: z.array(orderCancellationCandidateItemSchema).max(50),
  });
const orderCancellationCandidatesSchema = z.strictObject({
  ok: z.literal(true),
  orders: z.array(orderCancellationToolCandidateSchema).max(5),
});
const ORDER_CANDIDATE_RESERVATION: OrderCancellationCandidate[] = Array.from(
  { length: 5 },
  (_, orderIndex) => ({
    orderId: BINDING_ID_RESERVATION,
    orderNo: `ORDER-${'X'.repeat(100 - 6 - String(orderIndex).length)}`,
    status: 'pending_payment',
    payableAmount: '9999999999.99',
    createdAt: '9999-12-31T23:59:59.999Z',
    expiresAt: '9999-12-31T23:59:59.999Z',
    cancelable: true,
    items: Array.from({ length: 5 }, () => ({
      productName: '商'.repeat(60),
      color: '色'.repeat(16),
      size: '码'.repeat(16),
      quantity: 999,
    })),
  }),
);

const activitySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tool'),
    id: z.string().trim().min(1),
    toolName: z.string(),
    status: z.enum(['running', 'success', 'error', 'interrupted']),
  }),
  z.object({
    type: z.literal('reasoning'),
    id: z.string().trim().min(1),
    summary: z.string().trim().min(1),
  }),
]);

const productCardSchema = z.strictObject({
  externalId: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  brand: z.string().max(100).nullable(),
  category: z.enum(['tops', 'bottoms', 'dresses', 'outerwear', 'shoes']),
  description: z.string().max(2000).nullable(),
  imageUrl: z.string().max(2048).nullable(),
  productUrl: z.string().max(2048).nullable(),
  price: z.string().regex(/^\d{1,10}\.\d{2}$/u),
  currency: z.literal('CNY'),
  sizes: z.array(z.string().max(32)).max(100),
  colors: z.array(z.string().max(32)).max(100),
  inStock: z.boolean(),
  // 历史商品快照缺少开关时先关闭入口，读取阶段再用当前目录资格校正。
  tryOnEnabled: z.boolean().default(false),
  matchReasons: z
    .array(
      z.enum([
        'category_match',
        'size_match',
        'budget_match',
        'stock_available',
        'color_match',
        'style_match',
        'occasion_match',
        'fit_match',
        'preference_match',
      ]),
    )
    .max(9),
});

const productResultsSchema = z.strictObject({
  items: z.array(productCardSchema).max(20),
  nextCursor: z.string().max(4096).nullable(),
  noResultReason: z
    .enum([
      'NO_MATCHING_SIZE',
      'OVER_BUDGET',
      'OUT_OF_STOCK',
      'NO_MATCHING_PRODUCT',
    ])
    .nullable(),
  query: productSearchQuerySchema.optional(),
});

const chatOrderCardItemSchema = z.strictObject({
  productName: z.string().trim().min(1).max(200),
  color: z.string().max(100),
  size: z.string().max(100),
  quantity: z.number().int().positive().max(999),
});
const chatOrderCardSummarySchema = z.strictObject({
  orderNo: z.string().trim().min(1).max(100),
  status: z.enum([
    'pending_payment',
    'pending_shipment',
    'pending_receipt',
    'completed',
    'closed',
  ]),
  closeReason: z
    .enum(['user_cancelled', 'payment_expired', 'product_unavailable'])
    .nullable(),
  itemsAmount: z.string().regex(/^\d{1,10}\.\d{2}$/u),
  payableAmount: z.string().regex(/^\d{1,10}\.\d{2}$/u),
  itemCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.iso.datetime({ offset: true }),
  paidAt: z.iso.datetime({ offset: true }).nullable(),
  shippedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  items: z.array(chatOrderCardItemSchema).max(50),
});
const productChatCardSchema = z.strictObject({
  type: z.literal('card'),
  name: z.literal('product'),
  data: z.strictObject({
    items: z.array(productCardSchema).min(1).max(5),
  }),
});
const orderChatCardSchema = z.strictObject({
  type: z.literal('card'),
  name: z.literal('order'),
  data: z.strictObject({
    items: z.array(chatOrderCardSummarySchema).min(1).max(5),
  }),
});
export const chatCardSchema = z.discriminatedUnion('name', [
  productChatCardSchema,
  orderChatCardSchema,
]);

function uniqueReferences(maxLength: number) {
  return <T extends string>(value: T[]) =>
    new Set(value).size === value.length && value.length <= maxLength;
}

export const chatCardSelectionSchema = z.discriminatedUnion('name', [
  z.strictObject({
    name: z.literal('product'),
    externalIds: z
      .array(z.string().trim().min(1).max(160))
      .min(1)
      .max(5)
      .refine(uniqueReferences(5)),
  }),
  z.strictObject({
    name: z.literal('order'),
    orderNos: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(5)
      .refine(uniqueReferences(5)),
  }),
]);

const envelopeSchema = z.object({
  version: z.literal(1),
  assistantMessageId: z.uuid(),
  activities: z.array(activitySchema),
  sources: z.array(
    z.object({
      id: z.string().trim().min(1),
      title: z.string(),
      url: z.string(),
    }),
  ),
  cards: z.array(z.unknown()).default([]),
  // 缺字段兼容导购上线前已保存的聊天快照。
  productResults: z.array(productResultsSchema).max(5).default([]),
  orderCancellationCandidates: z
    .array(orderCancellationCandidateSchema)
    .max(5)
    .default([]),
  purchase: purchaseReferenceSchema.nullable().default(null),
  forms: z.array(dynamicFormReferenceSchema).max(5).default([]),
  tryOnResult: chatTryOnResultSchema.optional(),
  tryOnStatus: chatTryOnStatusSchema.optional(),
  context: z
    .object({
      contextWindowTokens: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER),
      inputTokens: z.unknown(),
      outputTokens: z.unknown(),
      usedTokens: z.unknown(),
    })
    .nullable(),
});

const privateIpv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  privateIpv4.addSubnet(address, prefix, 'ipv4');
}

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
const reservedIpv6 = new BlockList();
reservedIpv6.addSubnet('2001::', 23, 'ipv6');
reservedIpv6.addSubnet('2001:db8::', 32, 'ipv6');
reservedIpv6.addSubnet('2002::', 16, 'ipv6');

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function safeToolName(name: string): string {
  if (name === 'request_dynamic_form') return '动态表单';
  return name === 'local_echo_tool' || name === '本地验证工具'
    ? '本地验证工具'
    : '工具';
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function projectContext(
  contextWindowTokens: number,
  usage: Pick<LlmUsage, 'inputTokens' | 'outputTokens'> | null,
): ChatContextUsage {
  const inputTokens = tokenCount(usage?.inputTokens);
  const outputTokens = tokenCount(usage?.outputTokens);
  const sum =
    inputTokens === null || outputTokens === null
      ? null
      : inputTokens + outputTokens;
  return {
    contextWindowTokens,
    inputTokens,
    outputTokens,
    usedTokens: tokenCount(sum),
  };
}

export function publicSourceUrl(value: string): URL | null {
  if (!/^https?:\/\//i.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  ) {
    return null;
  }

  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  const family = isIP(hostname);
  if (family === 4) {
    return privateIpv4.check(hostname, 'ipv4') ? null : parsed;
  }
  if (family === 6) {
    return globalIpv6.check(hostname, 'ipv6') &&
      !reservedIpv6.check(hostname, 'ipv6')
      ? parsed
      : null;
  }
  // 只检查字面地址与保留域名，不做 DNS、预览或 favicon 网络请求。
  if (
    !hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/i.test(
      hostname,
    )
  ) {
    return null;
  }
  return parsed;
}

export function projectSources(
  sources: Array<{ id: string; title: string; url: string }>,
  identities: Map<string, string>,
  preserveIds = false,
  createId: (url: string) => string = () => randomUUID(),
): ChatSource[] {
  const result: ChatSource[] = [];
  const positions = new Map<string, number>();
  const usedIds = new Set<string>();
  for (const source of sources) {
    const parsed = publicSourceUrl(source.url);
    if (!parsed) continue;
    const url = parsed.toString();
    const title = source.title.trim() || parsed.hostname;
    const position = positions.get(url);
    if (position !== undefined) {
      if (source.title.trim()) result[position]!.title = title;
      continue;
    }

    const id = identities.get(url) ?? (preserveIds ? source.id : createId(url));
    // 历史中的不同来源共用 ID 会破坏前端稳定键，拒绝恢复该快照。
    if (usedIds.has(id)) throw new Error('来源标识重复');
    identities.set(url, id);
    usedIds.add(id);
    positions.set(url, result.length);
    result.push({ id, title, url });
  }
  return result;
}

export function displayEnvelope(
  data: ChatDisplayData,
  assistantMessageId = BINDING_ID_RESERVATION,
): PublicDisplayEnvelope {
  return {
    version: 1,
    assistantMessageId,
    activities: data.activities,
    sources: data.sources,
    cards: data.cards,
    productResults: data.productResults,
    orderCancellationCandidates: data.orderCancellationCandidates,
    context: data.context,
    purchase: data.purchase,
    ...(data.forms ? { forms: data.forms } : {}),
    ...(data.tryOnResult ? { tryOnResult: data.tryOnResult } : {}),
    ...(data.tryOnStatus ? { tryOnStatus: data.tryOnStatus } : {}),
  };
}

export function isValidPurchaseReference(
  value: unknown,
): value is PurchaseReference | null {
  return value === null || purchaseReferenceSchema.safeParse(value).success;
}

export function reservedDisplayBytes(data: ChatDisplayData): number {
  return jsonBytes(
    displayEnvelope({
      activities: data.activities,
      sources: data.sources,
      cards: data.cards,
      productResults: data.productResults,
      // 候选卡片字段均有长度上限，因此可预留可验证的最大合法投影空间。
      orderCancellationCandidates: ORDER_CANDIDATE_RESERVATION,
      // 预留流末绑定最大合法购买引用所需空间。
      purchase: PURCHASE_REFERENCE_RESERVATION,
      forms: Array.from({ length: 5 }, () => ({
        formId: BINDING_ID_RESERVATION,
        revision: Number.MAX_SAFE_INTEGER,
        formKind: 'x'.repeat(80),
        status: 'open' as const,
      })),
      tryOnResult: {
        taskId: BINDING_ID_RESERVATION,
        product: {
          externalId: 'x'.repeat(160),
          name: 'x'.repeat(200),
          color: 'x'.repeat(32),
        },
        result: {
          width: 4096,
          height: 4096,
          mimeType: 'image/webp',
        },
      },
      tryOnStatus: {
        status: 'timed_out',
        taskId: BINDING_ID_RESERVATION,
        code: 'X'.repeat(80),
      },
      // 在发送活动前预留最终用量数字，避免实时成功而最终绑定超限。
      context: {
        contextWindowTokens:
          data.context?.contextWindowTokens ?? Number.MAX_SAFE_INTEGER,
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: Number.MAX_SAFE_INTEGER,
        usedTokens: Number.MAX_SAFE_INTEGER,
      },
    }),
  );
}

export function restoreDisplay(value: unknown): PublicDisplayEnvelope | null {
  if (!isRecord(value)) return null;
  if (jsonBytes(value) > MAX_DISPLAY_BYTES) return null;
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) return null;
  const source = parsed.data;
  const activityIds = new Set<string>();
  const activities: ChatActivity[] = [];
  for (const activity of source.activities) {
    if (activityIds.has(activity.id)) return null;
    activityIds.add(activity.id);
    activities.push(
      activity.type === 'tool'
        ? {
            type: 'tool',
            id: activity.id,
            toolName: safeToolName(activity.toolName),
            status: activity.status,
            input: null,
            output: null,
          }
        : {
            type: 'reasoning',
            id: activity.id,
            summary: activity.summary,
          },
    );
  }
  const sources = projectSources(source.sources, new Map(), true);
  const cards: ChatCard[] = source.cards.flatMap((card) => {
    const restored = restoreChatCard(card);
    return restored ? [restored] : [];
  });
  const productResults: ChatProductResults[] = source.productResults.map(
    (entry) => {
      const { query, ...result } = entry;
      return {
        ...result,
        ...(query ? { query } : {}),
        items: entry.items.flatMap((item) => {
          const imageUrl = item.imageUrl
            ? (publicSourceUrl(item.imageUrl)?.toString() ?? null)
            : null;
          const productUrl = item.productUrl
            ? (publicSourceUrl(item.productUrl)?.toString() ?? null)
            : null;
          if (!item.name.trim() || !/^\d{1,10}\.\d{2}$/u.test(item.price))
            return [];
          return [
            {
              ...item,
              name: item.name.trim(),
              imageUrl,
              productUrl,
              sizes: [...new Set(item.sizes)],
              colors: [...new Set(item.colors)],
              matchReasons: [...new Set(item.matchReasons)],
            },
          ];
        }),
      };
    },
  );
  const orderCancellationCandidates: OrderCancellationCandidate[] =
    source.orderCancellationCandidates.map((candidate) => ({
      ...candidate,
      orderNo: candidate.orderNo.trim(),
      items: candidate.items.map((item) => ({
        ...item,
        productName: item.productName.trim(),
      })),
    }));
  const context = source.context
    ? projectContext(source.context.contextWindowTokens, {
        inputTokens: tokenCount(source.context.inputTokens),
        outputTokens: tokenCount(source.context.outputTokens),
      })
    : null;
  return displayEnvelope(
    {
      activities,
      sources,
      cards,
      productResults,
      orderCancellationCandidates,
      context,
      purchase: source.purchase,
      forms: source.forms ?? [],
      ...(source.tryOnResult
        ? { tryOnResult: source.tryOnResult as ChatTryOnResult }
        : {}),
      ...(source.tryOnStatus
        ? { tryOnStatus: source.tryOnStatus as ChatTryOnStatus }
        : {}),
    },
    source.assistantMessageId,
  );
}

export function restoreDynamicFormDefinition(value: unknown): DynamicFormDefinition | null {
  const parsed = dynamicFormDefinitionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type DynamicFormDefinition = z.infer<typeof dynamicFormDefinitionSchema>;

export function restoreDynamicFormReference(
  value: unknown,
): ChatDynamicFormReference | null {
  const parsed = dynamicFormReferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function restoreChatCard(value: unknown): ChatCard | null {
  const parsed = chatCardSchema.safeParse(value);
  if (!parsed.success) return null;
  const card = parsed.data;
  if (card.name === 'product') {
    return {
      ...card,
      data: {
        items: card.data.items.map((item) => ({
          ...item,
          imageUrl: item.imageUrl
            ? (publicSourceUrl(item.imageUrl)?.toString() ?? null)
            : null,
          productUrl: item.productUrl
            ? (publicSourceUrl(item.productUrl)?.toString() ?? null)
            : null,
        })),
      },
    };
  }
  return {
    ...card,
    data: {
      items: card.data.items.map((order) => ({
        ...order,
        orderNo: order.orderNo.trim(),
        items: order.items.map((item) => ({
          ...item,
          productName: item.productName.trim(),
        })),
      })),
    },
  };
}

export function restoreChatCardOutput(output: string): ChatCard | null {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  return restoreChatCard(value);
}

export function parseChatCardSelection(
  value: unknown,
): ChatCardSelection | null {
  const parsed = chatCardSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function restoreOrderCancellationCandidates(
  output: string,
): OrderCancellationCandidate[] | null {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  const parsed = orderCancellationCandidatesSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.orders.map((candidate) => ({
    ...candidate,
    orderNo: candidate.orderNo.trim(),
    // 工具完整保留最多 50 条给模型，公开卡片只展示已预留预算的前 5 条。
    items: candidate.items.slice(0, 5).map((item) => ({
      ...item,
      productName: item.productName.trim(),
    })),
  }));
}

export function restoreProductResults(
  output: string,
): ChatProductResults | null {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const parsed = productResultsSchema.safeParse(value);
  if (!parsed.success) return null;
  const result = parsed.data;
  const { query, ...productResults } = result;
  return {
    ...productResults,
    ...(query ? { query } : {}),
    items: result.items.map((item) => ({
      ...item,
      imageUrl: item.imageUrl
        ? (publicSourceUrl(item.imageUrl)?.toString() ?? null)
        : null,
      productUrl: item.productUrl
        ? (publicSourceUrl(item.productUrl)?.toString() ?? null)
        : null,
    })),
  };
}
