import assert from 'node:assert/strict';
import test from 'node:test';

import { IsolationLevel } from '@mikro-orm/core';

import { ProductSkuReaderService } from '../service/product-sku-reader.service.js';

const productId = '00000000-0000-4000-8000-000000000001';

function sku(overrides: Record<string, unknown> = {}) {
  return {
    color: '黑色',
    size: 'M',
    unit_price: '99.90',
    currency: 'CNY',
    in_stock: true,
    sku_id: 'private-sku',
    image_url: 'https://private.example.org/image.webp',
    stock: 999,
    reserved_quantity: 998,
    ...overrides,
  };
}

type FixtureOptions = {
  products?: unknown[];
  counts?: unknown[];
  rows?: unknown[];
  context?: object | null;
  failAt?: number;
  failFork?: boolean;
};

function fixture(options: FixtureOptions = {}) {
  const calls: Array<{
    sql: string;
    parameters: unknown[];
    method: string;
    context: unknown;
  }> = [];
  const forks: unknown[] = [];
  const transactions: unknown[] = [];
  const context = options.context === undefined ? {} : options.context;
  const connection = {
    execute: async (
      sql: string,
      parameters: unknown[],
      method: string,
      transactionContext: unknown,
    ) => {
      calls.push({ sql, parameters, method, context: transactionContext });
      if (options.failAt === calls.length) {
        throw new Error('private database credentials and SQL');
      }
      if (sql.includes('select id::text as id')) {
        return options.products ?? [{ id: productId }];
      }
      if (sql.includes('count(*)::text as total')) {
        return options.counts ?? [{ total: '1' }];
      }
      return options.rows ?? [sku()];
    },
  };
  const transaction = {
    getTransactionContext: () => context,
    getConnection: () => connection,
  };
  const fork = {
    transactional: async (
      callback: (em: typeof transaction) => unknown,
      options: unknown,
    ) => {
      transactions.push(options);
      return callback(transaction);
    },
  };
  const service = new ProductSkuReaderService({
    getEntityManager: () => ({
      fork: (forkOptions: unknown) => {
        forks.push(forkOptions);
        if (options.failFork) throw new Error('private fork failure');
        return fork;
      },
    }),
  } as never);
  return { service, calls, forks, transactions, context };
}

test('规格 reader 使用独立只读 RR，所有原生查询绑定同一事务', async () => {
  const subject = fixture();
  const result = await subject.service.listForChat({
    productExternalId: 'coat-1',
    page: 1,
  });
  assert.deepEqual(subject.forks, [
    { clear: true, useContext: false, keepTransactionContext: false },
  ]);
  assert.deepEqual(subject.transactions, [
    { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true },
  ]);
  assert.equal(subject.calls.length, 3);
  assert.equal(
    subject.calls.every(
      (call) => call.context === subject.context && call.method === 'all',
    ),
    true,
  );
  assert.deepEqual(result, {
    ok: true,
    productExternalId: 'coat-1',
    items: [
      {
        color: '黑色',
        size: 'M',
        unitPrice: '99.90',
        currency: 'CNY',
        inStock: true,
      },
    ],
    page: 1,
    pageSize: 5,
    total: 1,
    hasNext: false,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /private|sku_id|image|reserved|stock/u,
  );
  assert.match(subject.calls[0]!.sql, /is_active = true/u);
  assert.match(subject.calls[2]!.sql, /active_order_sku_reservations/u);
  assert.match(
    subject.calls[2]!.sql,
    /\(s\.stock - coalesce\(r\.reserved_quantity, 0\)\) > 0 as in_stock/u,
  );
});

test('颜色尺码交集在完整计数及分页 SQL 内生效，筛选文本仅作绑定参数', async () => {
  const subject = fixture();
  const maliciousColor = "黑色' OR 1=1 --";
  await subject.service.listForChat({
    productExternalId: ' Coat-1 ',
    color: maliciousColor,
    size: ' m ',
    page: 1,
  });
  assert.deepEqual(subject.calls[0]!.parameters, ['Coat-1']);
  for (const call of subject.calls.slice(1)) {
    assert.match(call.sql, /s\.is_active = true/u);
    assert.match(call.sql, /s\.currency = 'CNY'/u);
    assert.match(call.sql, /lower\(s\.color\) = lower\(\?\)/u);
    assert.match(call.sql, /lower\(s\.size\) = lower\(\?\)/u);
    assert.equal(call.sql.includes(maliciousColor), false);
  }
  assert.deepEqual(subject.calls[1]!.parameters, [
    productId,
    maliciousColor,
    'm',
  ]);
  assert.deepEqual(subject.calls[2]!.parameters, [
    productId,
    maliciousColor,
    'm',
    5,
    0,
  ]);
});

test('累计超过一百规格仍使用完整总数和指定页，不使用固定全量上限', async () => {
  const rows = Array.from({ length: 5 }, (_, index) =>
    sku({ unit_price: `${100 + index}.00`, in_stock: index !== 0 }),
  );
  const subject = fixture({ counts: [{ total: '121' }], rows });
  const result = await subject.service.listForChat({
    productExternalId: 'coat-1',
    page: 10,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.total, 121);
  assert.equal(result.items.length, 5);
  assert.equal(result.hasNext, true);
  assert.deepEqual(subject.calls[2]!.parameters, [productId, 5, 45]);
  assert.match(
    subject.calls[2]!.sql,
    /order by s\.id asc\s+limit \? offset \?/u,
  );
  assert.doesNotMatch(subject.calls[1]!.sql, /limit|offset/u);
  assert.equal(result.items[0]!.inStock, false);
  assert.deepEqual(
    result.items.map((item) => item.unitPrice),
    ['100.00', '101.00', '102.00', '103.00', '104.00'],
  );
});

test('无商品、不匹配、无货与超过结果范围的空页分别处理', async () => {
  const missing = fixture({ products: [] });
  assert.deepEqual(
    await missing.service.listForChat({
      productExternalId: 'missing',
      page: 1,
    }),
    { ok: false, code: 'not_found' },
  );
  assert.equal(missing.calls.length, 1);

  for (const [page, total] of [
    [1, '0'],
    [10, '7'],
  ] as const) {
    const empty = fixture({ counts: [{ total }], rows: [] });
    assert.deepEqual(
      await empty.service.listForChat({ productExternalId: 'coat-1', page }),
      {
        ok: true,
        productExternalId: 'coat-1',
        items: [],
        page,
        pageSize: 5,
        total: Number(total),
        hasNext: false,
      },
    );
  }
  const outOfStock = fixture({ rows: [sku({ in_stock: false })] });
  const result = await outOfStock.service.listForChat({
    productExternalId: 'coat-1',
    page: 1,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.items[0]!.inStock, false);
});

test('非法输入在创建 fork 和执行数据库查询前拒绝', async () => {
  for (const input of [
    { productExternalId: 'coat-1', page: '1' },
    { productExternalId: 'coat-1', page: 11 },
    { productExternalId: 'coat-1', page: 1, userId: 'stranger' },
    { productExternalId: 'coat-1', color: '\n黑色', page: 1 },
  ]) {
    const subject = fixture();
    await assert.rejects(subject.service.listForChat(input as never));
    assert.equal(subject.forks.length, 0);
    assert.equal(subject.calls.length, 0);
  }
});

test('依赖故障和缺少事务上下文只返回固定 unavailable', async () => {
  for (const options of [
    { failFork: true },
    { context: null },
    { failAt: 1 },
    { failAt: 2 },
    { failAt: 3 },
  ]) {
    const subject = fixture(options);
    assert.deepEqual(
      await subject.service.listForChat({
        productExternalId: 'coat-1',
        page: 1,
      }),
      { ok: false, code: 'unavailable' },
    );
    if (options.context === null) assert.equal(subject.calls.length, 0);
  }
});

test('非法计数和分页截断不能被解释为空结果或完整结果', async () => {
  for (const counts of [
    [],
    [{ total: null }],
    [{ total: 'NaN' }],
    [{ total: '-1' }],
    [{ total: '1.5' }],
    [{ total: '9007199254740992' }],
    [{ total: '6' }],
  ]) {
    const subject = fixture({ counts });
    assert.deepEqual(
      await subject.service.listForChat({
        productExternalId: 'coat-1',
        page: 1,
      }),
      { ok: false, code: 'unavailable' },
    );
  }
});

test('损坏规格使整次查询 unavailable，不跳过条目或回显原始行', async () => {
  for (const overrides of [
    { color: '\n黑色' },
    { size: '' },
    { unit_price: 'NaN' },
    { unit_price: '-1.00' },
    { unit_price: '10000000000.00' },
    { currency: 'USD' },
    { in_stock: null },
  ]) {
    const subject = fixture({ rows: [sku(overrides)] });
    assert.deepEqual(
      await subject.service.listForChat({
        productExternalId: 'coat-1',
        page: 1,
      }),
      { ok: false, code: 'unavailable' },
    );
  }
});
