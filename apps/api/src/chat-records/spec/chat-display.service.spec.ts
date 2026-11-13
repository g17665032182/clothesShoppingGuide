import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { LockMode } from '@mikro-orm/core';

import {
  displayEnvelope,
  jsonBytes,
  MAX_DISPLAY_BYTES,
  publicSourceUrl,
  reservedDisplayBytes,
  restoreChatCard,
  restoreDisplay,
  restoreProductResults,
} from '../display/chat-display.projection.js';
import { ChatDisplayService } from '../display/chat-display.service.js';
import type { ChatProductCard } from '../display/chat-display.types.js';
import type { TryOnProductProjection } from '../../product-catalog/index.js';
import {
  ChatTraceEvent,
  ChatTraceEventType,
} from '../entity/chat-trace-event.entity.js';

const conversationId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const assistantMessageId = '33333333-3333-4333-8333-333333333333';
const purchaseReference = {
  draftId: '44444444-4444-4444-8444-444444444444',
  version: 12,
  orderId: null,
};

function createState() {
  const rows: ChatTraceEvent[] = [];
  const queries: unknown[] = [];
  const locks: unknown[] = [];
  const products = new Map<string, TryOnProductProjection>();
  const catalogRequests: string[][] = [];
  let catalogFailureAfter = Infinity;
  let flushCount = 0;
  const repository = {
    async find(where: unknown, options: unknown) {
      queries.push({ where, options });
      return rows;
    },
  };
  const transaction = {
    async findOne(
      _entity: typeof ChatTraceEvent,
      where: Partial<ChatTraceEvent>,
      options: unknown,
    ) {
      locks.push({ where, options });
      return (
        rows.find((row) =>
          Object.entries(where).every(
            ([key, value]) => row[key as keyof ChatTraceEvent] === value,
          ),
        ) ?? null
      );
    },
    async flush() {
      flushCount += 1;
    },
  };
  return {
    rows,
    queries,
    locks,
    products,
    catalogRequests,
    failCatalog(afterSuccessfulRequests = 0) {
      catalogFailureAfter = catalogRequests.length + afterSuccessfulRequests;
    },
    transaction,
    display: new ChatDisplayService(
      repository as never,
      {
        async getTryOnProducts(externalIds: string[]) {
          catalogRequests.push(externalIds);
          if (catalogRequests.length > catalogFailureAfter) {
            throw new Error('private catalog failure');
          }
          return new Map(
            externalIds.flatMap((externalId) => {
              const product = products.get(externalId);
              return product ? [[externalId, product] as const] : [];
            }),
          );
        },
      } as never,
    ),
    get flushCount() {
      return flushCount;
    },
  };
}

function productCard(externalId = 'coat-1'): ChatProductCard {
  return {
    externalId,
    name: '历史大衣',
    brand: null,
    category: 'outerwear',
    description: null,
    imageUrl: 'https://images.example.com/old-coat.webp',
    productUrl: 'https://shop.example.com/old-coat',
    price: '899.00',
    currency: 'CNY',
    sizes: ['M'],
    colors: ['黑色'],
    inStock: true,
    tryOnEnabled: true,
    matchReasons: ['size_match'],
  };
}

function tryOnProduct(
  externalId: string,
  enabled = true,
  eligible = true,
): TryOnProductProjection {
  return {
    productExternalId: externalId,
    productName: '当前商品名称',
    category: 'outerwear',
    tryOnEnabled: enabled,
    tryOnEligible: eligible,
    tryOnImageObjectKey: null,
    mainImageUrl: 'https://images.example.com/current-coat.webp',
    colors: [{ color: '黑色', imageUrl: null }],
  };
}

function trace(payload: ChatTraceEvent['payload'] = null) {
  return Object.assign(new ChatTraceEvent(), {
    conversationId,
    runId,
    sequence: 7,
    eventType: ChatTraceEventType.MODEL_RESPONSE,
    messageId: 'langchain-final-message',
    payload,
  });
}

test('回显和未知工具只显示安全名称、状态，同 ID 原地更新且不泄漏任意输入输出', () => {
  const { display } = createState();
  const data = display.create(10_000);
  display.apply(data, {
    type: 'tool-call',
    id: 'call-1',
    toolName: 'local_echo_tool',
    input: { value: 'sensitive private text' },
  });
  display.apply(data, {
    type: 'tool-call',
    id: 'call-2',
    toolName: '/private/internal/service',
    input: 'private data',
  });
  display.apply(data, {
    type: 'tool-result',
    id: 'call-1',
    toolName: 'local_echo_tool',
    status: 'error',
    output: 'private exception and stack',
  });
  assert.deepEqual(data.activities, [
    {
      type: 'tool',
      id: 'call-1',
      toolName: '本地验证工具',
      status: 'error',
      input: null,
      output: null,
    },
    {
      type: 'tool',
      id: 'call-2',
      toolName: '工具',
      status: 'running',
      input: null,
      output: null,
    },
  ]);
  assert.equal(JSON.stringify(data).includes('private'), false);
});

test('商品搜索结果只投影白名单字段并绑定到公开聊天快照', () => {
  const { display } = createState();
  const data = display.create(10_000);
  display.apply(data, {
    type: 'tool-call',
    id: 'product-call',
    toolName: 'search_local_clothing_products',
    input: { size: 'M', limit: 20 },
  });
  const results = {
    items: [
      {
        externalId: 'coat-1',
        name: '羊毛大衣',
        brand: '本地品牌',
        category: 'outerwear',
        description: null,
        imageUrl: 'http://127.0.0.1/internal.png',
        productUrl: 'https://shop.example.com/coat-1',
        price: '899.00',
        currency: 'CNY',
        sizes: ['M'],
        colors: ['黑色'],
        inStock: true,
        matchReasons: ['size_match'],
      },
    ],
    nextCursor: null,
    noResultReason: null,
  };
  const event = display.apply(data, {
    type: 'tool-result',
    id: 'product-call',
    toolName: 'search_local_clothing_products',
    status: 'success',
    output: JSON.stringify(results),
  });
  assert.equal(event?.type, 'product-results');
  assert.equal(data.activities[0]?.type, 'tool');
  assert.equal(data.activities[0]?.status, 'success');
  assert.equal(data.productResults[0]?.items[0]?.imageUrl, null);
  assert.deepEqual(data.productResults[0]?.query, {
    size: 'M',
    limit: 3,
  });
  assert.equal(JSON.stringify(data).includes('internalSkuId'), false);
  const restored = restoreDisplay(displayEnvelope(data, assistantMessageId));
  assert.equal(restored?.productResults[0]?.items[0]?.price, '899.00');
  assert.equal(restored?.productResults[0]?.items[0]?.tryOnEnabled, false);
  assert.deepEqual(restored?.productResults[0]?.query, {
    size: 'M',
    limit: 3,
  });
});

test('商品工具结果非法时不生成公开商品投影', () => {
  assert.equal(restoreProductResults('not-json'), null);
  assert.equal(
    restoreProductResults(
      JSON.stringify({
        items: [{ externalId: 'private', databaseId: 'hidden' }],
        nextCursor: null,
        noResultReason: null,
      }),
    ),
    null,
  );
  const oldSnapshot = {
    version: 1,
    assistantMessageId,
    activities: [],
    sources: [],
    context: null,
  };
  assert.deepEqual(restoreDisplay(oldSnapshot)?.productResults, []);
  assert.deepEqual(
    restoreDisplay(oldSnapshot)?.orderCancellationCandidates,
    [],
  );
  assert.equal(restoreDisplay(oldSnapshot)?.purchase, null);
});

test('展示工具只发布已暂存的白名单卡片并兼容损坏历史卡片', () => {
  const { display } = createState();
  const data = display.create(10_000);
  const card = {
    type: 'card' as const,
    name: 'product' as const,
    data: { items: [productCard()] },
  };

  display.apply(data, {
    type: 'tool-call',
    id: 'card-call',
    toolName: 'display_chat_card',
    input: { name: 'product', externalIds: ['coat-1'] },
  });
  const staged = display.stageCard(data, card);
  const event = display.apply(data, {
    type: 'tool-result',
    id: 'card-call',
    toolName: 'display_chat_card',
    status: 'success',
    output: JSON.stringify(staged),
  });

  assert.deepEqual(event, { type: 'card', card });
  assert.deepEqual(data.cards, [card]);
  const restored = restoreDisplay(displayEnvelope(data, assistantMessageId));
  assert.deepEqual(restored?.cards, [card]);

  const damaged = restoreDisplay({
    ...displayEnvelope(data, assistantMessageId),
    cards: [
      card,
      {
        ...card,
        data: { items: [{ ...productCard(), privateField: 'secret' }] },
      },
      { type: 'card', name: 'unknown', data: {} },
    ],
  });
  assert.deepEqual(damaged?.cards, [card]);
});

test('地址选择卡仅保存草稿引用并只在安全工具结果后发送', () => {
  const { display } = createState();
  const data = display.create(10_000);
  const draftId = '44444444-4444-4444-8444-444444444444';
  const card = display.stageAddressSelection(data, draftId, 7);

  assert.deepEqual(card, {
    type: 'card',
    name: 'address_selection',
    data: { draftId, draftVersion: 7 },
  });
  assert.equal(
    restoreChatCard({
      ...card,
      data: { ...card.data, addressId: 'private-address-id' },
    }),
    null,
  );

  const event = display.apply(data, {
    type: 'tool-result',
    id: 'information-call',
    toolName: 'get_my_information',
    status: 'success',
    output: '{"ok":true}',
  });
  assert.deepEqual(event, { type: 'card', card });
  assert.deepEqual(
    restoreDisplay(displayEnvelope(data, assistantMessageId))?.cards,
    [card],
  );
});

test('未由当前展示工具暂存的卡片结果不会进入公开展示', () => {
  const { display } = createState();
  const data = display.create(10_000);
  const card = {
    type: 'card',
    name: 'product',
    data: { items: [productCard()] },
  };
  const event = display.apply(data, {
    type: 'tool-result',
    id: 'untrusted-card',
    toolName: 'display_chat_card',
    status: 'success',
    output: JSON.stringify(card),
  });
  assert.notEqual(event?.type, 'card');
  assert.deepEqual(data.cards, []);
});

test('仅待付款订单工具查询的严格成功结果生成候选卡片并可恢复', () => {
  const { display } = createState();
  const data = display.create(10_000);
  const order = {
    orderId: '55555555-5555-4555-8555-555555555555',
    orderNo: 'ORDER-1001',
    status: 'pending_payment',
    payableAmount: '199.00',
    createdAt: '2026-11-10T09:00:00.000Z',
    expiresAt: '2026-11-10T10:00:00.000Z',
    cancelable: true,
    items: [
      {
        productName: '羊毛大衣',
        color: '深灰',
        size: 'M',
        quantity: 1,
      },
    ],
  };
  display.apply(data, {
    type: 'tool-call',
    id: 'orders-call',
    toolName: 'list_my_orders',
    input: { status: 'pending_payment', userId: 'must-not-be-trusted' },
  });
  const event = display.apply(data, {
    type: 'tool-result',
    id: 'orders-call',
    toolName: 'list_my_orders',
    status: 'success',
    output: JSON.stringify({ ok: true, orders: [order] }),
  });
  assert.equal(event?.type, 'order-cancellation-candidates');
  assert.deepEqual(
    event?.type === 'order-cancellation-candidates'
      ? event.orderCancellationCandidates
      : [],
    [order],
  );
  assert.deepEqual(data.orderCancellationCandidates, [order]);
  const restored = restoreDisplay(displayEnvelope(data, assistantMessageId));
  assert.deepEqual(restored?.orderCancellationCandidates, [order]);
  assert.ok(reservedDisplayBytes(data) <= MAX_DISPLAY_BYTES);
});

test('普通订单查询、失败结果和含未知字段的结果均不生成取消候选', () => {
  const malformedOrder = {
    orderId: '55555555-5555-4555-8555-555555555555',
    orderNo: 'ORDER-1001',
    status: 'pending_payment',
    payableAmount: '199.00',
    createdAt: '2026-11-10T09:00:00.000Z',
    expiresAt: '2026-11-10T10:00:00.000Z',
    cancelable: true,
    recipientPhone: '13812345678',
    items: [],
  };
  const scenarios = [
    {
      input: { status: 'pending_shipment' },
      status: 'success' as const,
      output: JSON.stringify({ ok: true, orders: [] }),
    },
    {
      input: { status: 'pending_payment' },
      status: 'error' as const,
      output: JSON.stringify({ ok: false, orders: [] }),
    },
    {
      input: { status: 'pending_payment' },
      status: 'success' as const,
      output: JSON.stringify({ ok: true, orders: [malformedOrder] }),
    },
  ];
  for (const scenario of scenarios) {
    const { display } = createState();
    const data = display.create(10_000);
    display.apply(data, {
      type: 'tool-call',
      id: 'orders-call',
      toolName: 'list_my_orders',
      input: scenario.input,
    });
    const event = display.apply(data, {
      type: 'tool-result',
      id: 'orders-call',
      toolName: 'list_my_orders',
      status: scenario.status,
      output: scenario.output,
    });
    assert.notEqual(event?.type, 'order-cancellation-candidates');
    assert.deepEqual(data.orderCancellationCandidates, []);
  }
});

test('完整校验最多 50 条工具明细，公开订单卡片只保留前 5 条', () => {
  const { display } = createState();
  const data = display.create(10_000);
  const items = Array.from({ length: 6 }, (_, index) => ({
    productName: `商品${index + 1}`,
    color: '黑色',
    size: 'M',
    quantity: 1,
  }));
  display.apply(data, {
    type: 'tool-call',
    id: 'orders-call',
    toolName: 'list_my_orders',
    input: { status: 'pending_payment' },
  });
  const event = display.apply(data, {
    type: 'tool-result',
    id: 'orders-call',
    toolName: 'list_my_orders',
    status: 'success',
    output: JSON.stringify({
      ok: true,
      orders: [
        {
          orderId: '55555555-5555-4555-8555-555555555555',
          orderNo: 'ORDER-1001',
          status: 'pending_payment',
          payableAmount: '199.00',
          createdAt: '2026-11-10T09:00:00.000Z',
          expiresAt: '2026-11-10T10:00:00.000Z',
          cancelable: true,
          items,
        },
      ],
    }),
  });
  assert.equal(event?.type, 'order-cancellation-candidates');
  assert.deepEqual(
    data.orderCancellationCandidates[0]?.items,
    items.slice(0, 5),
  );
  assert.equal(data.orderCancellationCandidates[0]?.items.length, 5);
  assert.ok(reservedDisplayBytes(data) <= MAX_DISPLAY_BYTES);
});

test('旧商品快照缺少试穿开关时默认关闭，非法类型仍拒绝整个投影', () => {
  const { tryOnEnabled: _tryOnEnabled, ...oldCard } = productCard();
  const result = {
    items: [oldCard],
    nextCursor: null,
    noResultReason: null,
  };
  assert.equal(
    restoreProductResults(JSON.stringify(result))?.items[0]?.tryOnEnabled,
    false,
  );
  for (const invalid of ['true', null, 1]) {
    assert.equal(
      restoreProductResults(
        JSON.stringify({
          ...result,
          items: [{ ...oldCard, tryOnEnabled: invalid }],
        }),
      ),
      null,
    );
  }
});

test('购买引用恢复为可空投影且容量预留包含最大合法引用', () => {
  const { display } = createState();
  const data = display.create(1_000);
  const before = reservedDisplayBytes(data);
  display.setPurchaseReference(data, purchaseReference);
  const restored = restoreDisplay(displayEnvelope(data, assistantMessageId));
  assert.deepEqual(restored?.purchase, purchaseReference);
  assert.ok(reservedDisplayBytes(data) >= before);

  const invalid = { ...purchaseReference, version: 0 };
  assert.throws(
    () => display.setPurchaseReference(data, invalid),
    /安全保存要求/u,
  );
  assert.deepEqual(data.purchase, purchaseReference);
});

test('正文不会派生 reasoning，只有显式公开摘要可以更新活动', () => {
  const { display } = createState();
  const data = display.create(100);
  assert.equal(
    display.apply(data, { type: 'delta', content: 'https://example.com text' }),
    null,
  );
  assert.deepEqual(data.activities, []);
  assert.deepEqual(data.sources, []);
  display.apply(data, { type: 'reasoning', id: 'r1', summary: '公开摘要' });
  display.apply(data, { type: 'reasoning', id: 'r1', summary: '更新摘要' });
  assert.deepEqual(data.activities, [
    { type: 'reasoning', id: 'r1', summary: '更新摘要' },
  ]);
});

test('上下文只使用最终 usage，保留零、未知项和固定窗口，不使用 totalTokens 补齐', () => {
  const { display } = createState();
  const data = display.create(1_000);
  assert.deepEqual(structuredClone(data.context), {
    contextWindowTokens: 1_000,
    inputTokens: null,
    outputTokens: null,
    usedTokens: null,
  });
  display.complete(data, { inputTokens: 0, outputTokens: 0, totalTokens: 90 });
  assert.equal(data.context?.usedTokens, 0);
  display.complete(data, {
    inputTokens: 20,
    outputTokens: null,
    totalTokens: 90,
  });
  assert.deepEqual(structuredClone(data.context), {
    contextWindowTokens: 1_000,
    inputTokens: 20,
    outputTokens: null,
    usedTokens: null,
  });
  display.complete(data, {
    inputTokens: -1,
    outputTokens: 1.5,
    totalTokens: 90,
  });
  assert.equal(data.context?.inputTokens, null);
  assert.equal(data.context?.outputTokens, null);
  display.complete(data, {
    inputTokens: Number.MAX_SAFE_INTEGER,
    outputTokens: 1,
    totalTokens: null,
  });
  assert.equal(data.context?.usedTokens, null);
  display.complete(data, null);
  assert.equal(data.context?.inputTokens, null);
  assert.equal(data.context?.contextWindowTokens, 1_000);
  assert.throws(() => display.create(0), /窗口配置无效/u);
});

test('来源只允许外部绝对 HTTP URL，拒绝凭证、内网字面地址和保留域名', () => {
  for (const url of [
    '/relative',
    'https:/example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:password@example.com',
    'http://localhost/a',
    'http://localhost./a',
    'http://sub.localhost',
    'http://machine',
    'http://metadata.google.internal',
    'http://127.0.0.1',
    'http://0x7f000001',
    'http://2130706433',
    'http://169.254.169.254',
    'http://10.0.0.1',
    'http://172.16.1.1',
    'http://192.168.1.1',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[fe80::1]',
    'http://[fc00::1]',
  ]) {
    assert.equal(publicSourceUrl(url), null, url);
  }
  assert.equal(
    publicSourceUrl('https://EXAMPLE.com/a?q=1#part')?.toString(),
    'https://example.com/a?q=1#part',
  );
  assert.ok(publicSourceUrl('https://8.8.8.8'));
  assert.ok(publicSourceUrl('https://[2606:4700:4700::1111]'));
});

test('来源快照替换、按标准 URL 去重，移除后再次出现仍保留本轮 ID', () => {
  const { display } = createState();
  const data = display.create(1_000);
  display.apply(data, {
    type: 'sources',
    sources: [
      { id: 'untrusted-id', title: '', url: 'https://EXAMPLE.com' },
      { id: 'other-id', title: '最新标题', url: 'https://example.com/' },
      { id: 'private', title: '内网', url: 'http://localhost' },
      { id: 'next', title: '', url: 'https://example.com/page' },
    ],
  });
  assert.equal(data.sources.length, 2);
  const firstId = data.sources[0]!.id;
  assert.notEqual(firstId, 'untrusted-id');
  assert.equal(data.sources[0]!.title, '最新标题');
  assert.equal(data.sources[1]!.title, 'example.com');
  display.apply(data, { type: 'sources', sources: [] });
  assert.deepEqual(structuredClone(data.sources), []);
  display.apply(data, {
    type: 'sources',
    sources: [{ id: 'replacement', title: '恢复', url: 'https://example.com' }],
  });
  assert.equal(data.sources[0]!.id, firstId);
});

test('UTF-8 完整快照预算在发出更新前检查，超限不修改已有状态且为最终 context 留空间', () => {
  const { display } = createState();
  const data = display.create(1_000);
  const remaining = MAX_DISPLAY_BYTES - reservedDisplayBytes(data);
  display.apply(data, {
    type: 'reasoning',
    id: 'r',
    summary: 'x'.repeat(remaining - 100),
  });
  display.complete(data, {
    inputTokens: Number.MAX_SAFE_INTEGER,
    outputTokens: 0,
    totalTokens: null,
  });
  assert.ok(jsonBytes(displayEnvelope(data)) <= MAX_DISPLAY_BYTES);
  const snapshot = structuredClone(data);
  assert.throws(
    () =>
      display.apply(data, {
        type: 'reasoning',
        id: 'r',
        summary: '中'.repeat(6_000),
      }),
    /安全保存上限/u,
  );
  assert.deepEqual(data, snapshot);
  assert.throws(
    () =>
      display.apply(data, {
        type: 'reasoning',
        id: 'r',
        summary: `正文${'\n'.repeat(9_000)}结尾`,
      }),
    /安全保存上限/u,
  );
  assert.deepEqual(data, snapshot);
});

test('绑定锁定精确最终 trace、合并原字段、保留 LangChain ID，并校验幂等与冲突', async () => {
  const state = createState();
  const row = trace({ toolCalls: [], original: 'unchanged' });
  state.rows.push(row);
  const data = state.display.complete(state.display.create(1_000), null);
  const input = {
    conversationId,
    runId,
    sequence: 7,
    assistantMessageId,
    data,
  };
  await state.display.bind(state.transaction as never, input);
  assert.equal(row.messageId, 'langchain-final-message');
  assert.equal((row.payload as Record<string, unknown>).original, 'unchanged');
  assert.deepEqual(state.locks[0], {
    where: {
      conversationId,
      runId,
      sequence: 7,
      eventType: ChatTraceEventType.MODEL_RESPONSE,
    },
    options: { lockMode: LockMode.PESSIMISTIC_WRITE },
  });
  await state.display.bind(state.transaction as never, input);
  assert.equal(state.flushCount, 1);
  await assert.rejects(
    state.display.bind(state.transaction as never, {
      ...input,
      assistantMessageId: '44444444-4444-4444-8444-444444444444',
    }),
    /绑定冲突/u,
  );
  await assert.rejects(
    state.display.bind(state.transaction as never, {
      ...input,
      data: state.display.create(2_000),
    }),
    /绑定冲突/u,
  );
  await assert.rejects(
    state.display.bind(state.transaction as never, {
      ...input,
      sequence: 6,
    }),
    /无法绑定/u,
  );
});

test('合并后 payload 超过既有上限时拒绝绑定，不改写已持久化 trace', async () => {
  const state = createState();
  const row = trace({ original: 'x'.repeat(32_600) });
  state.rows.push(row);
  await assert.rejects(
    state.display.bind(state.transaction as never, {
      conversationId,
      runId,
      sequence: 7,
      assistantMessageId,
      data: state.display.create(1_000),
    }),
    /安全保存上限/u,
  );
  assert.equal(Object.hasOwn(row.payload!, 'publicDisplay'), false);
  assert.equal(state.flushCount, 0);
});

test('历史按当前页批量查询、重新投影敏感字段和 URL，旧消息无额外查询', async () => {
  const state = createState();
  assert.equal((await state.display.read(conversationId, [])).size, 0);
  assert.equal(state.queries.length, 0);
  state.rows.push(
    trace({
      publicDisplay: {
        version: 1,
        assistantMessageId,
        activities: [
          {
            type: 'tool',
            id: 'tool-1',
            toolName: 'local_echo_tool',
            status: 'success',
            input: { password: 'not public' },
            output: 'sensitive text',
          },
        ],
        sources: [
          { id: 'source-1', title: '来源', url: 'https://example.com' },
          { id: 'source-2', title: '忽略', url: 'https://EXAMPLE.com/' },
          { id: 'private', title: '内网', url: 'http://localhost' },
        ],
        context: {
          contextWindowTokens: 8_000,
          inputTokens: 10,
          outputTokens: 20,
          usedTokens: 999,
          privateField: 'hidden',
        },
        privateField: 'hidden',
      },
    }),
  );
  const result = await state.display.read(conversationId, [
    assistantMessageId,
    assistantMessageId,
  ]);
  assert.equal(state.queries.length, 1);
  assert.deepEqual(state.queries[0], {
    where: {
      conversationId,
      eventType: ChatTraceEventType.MODEL_RESPONSE,
      payload: {
        publicDisplay: { assistantMessageId: { $in: [assistantMessageId] } },
      },
    },
    options: { fields: ['id', 'runId', 'sequence', 'payload'] },
  });
  const display = result.get(assistantMessageId)!;
  assert.equal(display.sources.length, 1);
  assert.equal(display.sources[0]?.id, 'source-1');
  assert.equal(display.context?.usedTokens, 30);
  assert.equal(display.context?.contextWindowTokens, 8_000);
  assert.equal(JSON.stringify(display).includes('sensitive'), false);
  assert.equal(JSON.stringify(display).includes('hidden'), false);
});

test('历史无效版本、无效结构和重复绑定均降级为空展示，不选择任意 trace', async () => {
  const state = createState();
  const valid = displayEnvelope(
    state.display.create(1_000),
    assistantMessageId,
  );
  state.rows.push(trace({ publicDisplay: { ...valid, version: 2 } }));
  assert.equal(
    (await state.display.read(conversationId, [assistantMessageId])).size,
    0,
  );
  state.rows.splice(0, state.rows.length, trace({ publicDisplay: valid }));
  state.rows.push(trace({ publicDisplay: { ...valid, context: 'invalid' } }));
  assert.equal(
    (await state.display.read(conversationId, [assistantMessageId])).size,
    0,
  );
});

test('历史按当前资格更新试穿开关，旧字段也可恢复且不写回商品快照', async () => {
  const state = createState();
  const cards = ['enabled', 'disabled', 'ineligible', 'missing'].map(
    productCard,
  );
  const { tryOnEnabled: _tryOnEnabled, ...legacyCard } = cards[0]!;
  const original = {
    ...displayEnvelope(state.display.create(1_000), assistantMessageId),
    productResults: [
      {
        items: [legacyCard, ...cards.slice(1)],
        nextCursor: null,
        noResultReason: null,
      },
    ],
  };
  state.rows.push(trace({ publicDisplay: original }));
  state.products.set('enabled', tryOnProduct('enabled'));
  state.products.set('disabled', tryOnProduct('disabled', false));
  state.products.set('ineligible', tryOnProduct('ineligible', true, false));
  const before = structuredClone(state.rows[0]!.payload);

  const result = await state.display.read(conversationId, [assistantMessageId]);
  const items = result.get(assistantMessageId)!.productResults[0]!.items;
  assert.deepEqual(
    items.map((item) => item.tryOnEnabled),
    [true, false, false, false],
  );
  assert.equal(items[0]?.name, '历史大衣');
  assert.equal(items[0]?.price, '899.00');
  assert.equal(items[0]?.imageUrl, 'https://images.example.com/old-coat.webp');
  assert.deepEqual(state.rows[0]!.payload, before);
  assert.equal(state.flushCount, 0);

  state.products.set('enabled', tryOnProduct('enabled', false));
  const refreshed = await state.display.read(conversationId, [
    assistantMessageId,
  ]);
  assert.equal(
    refreshed.get(assistantMessageId)?.productResults[0]?.items[0]
      ?.tryOnEnabled,
    false,
  );
});

test('历史资格读取去重并以最多 200 件分批，目录异常时所有入口关闭', async () => {
  const state = createState();
  const ids: string[] = [];
  const cards = Array.from({ length: 205 }, (_, index) =>
    productCard(`product-${index}`),
  );
  cards.push(productCard('product-0'));
  for (let offset = 0; offset < cards.length; offset += 20) {
    const id = randomUUID();
    ids.push(id);
    state.rows.push(
      trace({
        publicDisplay: {
          ...displayEnvelope(state.display.create(1_000), id),
          productResults: [
            {
              items: cards.slice(offset, offset + 20),
              nextCursor: null,
              noResultReason: null,
            },
          ],
        },
      }),
    );
  }
  for (const card of cards)
    state.products.set(card.externalId, tryOnProduct(card.externalId));
  const result = await state.display.read(conversationId, ids);
  assert.deepEqual(
    state.catalogRequests.map((request) => request.length),
    [200, 5],
  );
  assert.equal(new Set(state.catalogRequests.flat()).size, 205);
  assert.ok(
    [...result.values()].every((display) =>
      display.productResults[0]!.items.every((item) => item.tryOnEnabled),
    ),
  );

  state.failCatalog(1);
  const failed = await state.display.read(conversationId, ids);
  assert.equal(failed.size, ids.length);
  assert.ok(
    [...failed.values()].every((display) =>
      display.productResults[0]!.items.every((item) => !item.tryOnEnabled),
    ),
  );
  assert.equal(
    JSON.stringify([...failed.values()]).includes('private catalog failure'),
    false,
  );
});
