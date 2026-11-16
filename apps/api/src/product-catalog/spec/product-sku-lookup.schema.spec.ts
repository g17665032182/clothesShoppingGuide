import assert from 'node:assert/strict';
import test from 'node:test';

import {
  productSkuLookupResultSchema,
  productSkuLookupSchema,
} from '../dto/product-sku-lookup.dto.js';

const item = {
  color: '黑色',
  size: 'M',
  unitPrice: '99.90',
  currency: 'CNY',
  inStock: true,
};

function page(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    productExternalId: 'coat-1',
    items: [item],
    page: 1,
    pageSize: 5,
    total: 1,
    hasNext: false,
    ...overrides,
  };
}

test('规格输入只修剪普通空格并默认第一页，保留外部标识及筛选大小写', () => {
  assert.deepEqual(
    productSkuLookupSchema.parse({
      productExternalId: ' Coat-1 ',
      color: ' Black ',
      size: ' m ',
    }),
    { productExternalId: 'Coat-1', color: 'Black', size: 'm', page: 1 },
  );
  assert.equal(
    productSkuLookupSchema.parse({ productExternalId: 'coat-1', page: 10 })
      .page,
    10,
  );
});

test('规格输入拒绝非法分页、空文本、越界文本及未知身份和动作字段', () => {
  const invalid: unknown[] = [
    {},
    ...[0, 11, 1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(
      (page) => ({ productExternalId: 'coat-1', page }),
    ),
    { productExternalId: ' ' },
    { productExternalId: 'a'.repeat(161) },
    { productExternalId: 'coat-1', color: '' },
    { productExternalId: 'coat-1', size: 'a'.repeat(33) },
    ...['userId', 'conversationId', 'skuId', 'pageSize', 'action', 'url'].map(
      (field) => ({ productExternalId: 'coat-1', [field]: 'forbidden' }),
    ),
  ];
  for (const input of invalid) {
    assert.equal(productSkuLookupSchema.safeParse(input).success, false);
  }
});

test('规格输入在 trim 前拒绝首尾及内部控制字符', () => {
  for (const field of ['productExternalId', 'color', 'size']) {
    for (const value of ['\nBlack', 'Black\t', 'Bl\u0000ack', 'Black\u007f']) {
      assert.equal(
        productSkuLookupSchema.safeParse({
          productExternalId: 'coat-1',
          [field]: value,
        }).success,
        false,
      );
    }
  }
});

test('规格输出接受安全金额边界、真实空页与固定失败', () => {
  for (const unitPrice of ['0.00', '99.90', '9999999999.99']) {
    assert.equal(
      productSkuLookupResultSchema.safeParse(
        page({ items: [{ ...item, unitPrice }] }),
      ).success,
      true,
    );
  }
  assert.equal(
    productSkuLookupResultSchema.safeParse(
      page({ items: [], page: 10, total: 7 }),
    ).success,
    true,
  );
  for (const code of ['not_found', 'unavailable']) {
    assert.deepEqual(productSkuLookupResultSchema.parse({ ok: false, code }), {
      ok: false,
      code,
    });
  }
});

test('规格输出拒绝非法金额、非 CNY、额外管理字段和异常原文', () => {
  for (const unitPrice of [
    '-1.00',
    '1',
    '1.1',
    '1.000',
    'NaN',
    '1e2',
    '10000000000.00',
  ]) {
    assert.equal(
      productSkuLookupResultSchema.safeParse(
        page({ items: [{ ...item, unitPrice }] }),
      ).success,
      false,
    );
  }
  for (const unsafeItem of [
    { ...item, currency: 'USD' },
    { ...item, inStock: 'true' },
    { ...item, color: '\n黑色' },
    { ...item, size: ' ' },
    ...['skuId', 'imageUrl', 'stock', 'reservedStock'].map((field) => ({
      ...item,
      [field]: 'private',
    })),
  ]) {
    assert.equal(
      productSkuLookupResultSchema.safeParse(page({ items: [unsafeItem] }))
        .success,
      false,
    );
  }
  for (const unsafe of [
    page({ userId: 'private-user' }),
    { ok: false, code: 'unavailable', message: 'private SQL' },
    { ok: false, code: 'invalid' },
  ]) {
    assert.equal(productSkuLookupResultSchema.safeParse(unsafe).success, false);
  }
});

test('规格输出拒绝被截断的页、错误总数和伪造后续页标记', () => {
  for (const unsafe of [
    page({ total: 6, hasNext: true }),
    page({ hasNext: true }),
    page({ items: [], total: 1 }),
    page({ total: -1 }),
    page({ total: 1.5 }),
    page({ total: Number.MAX_SAFE_INTEGER + 1 }),
    page({ pageSize: 20 }),
    page({ items: Array.from({ length: 6 }, () => item), total: 6 }),
  ]) {
    assert.equal(productSkuLookupResultSchema.safeParse(unsafe).success, false);
  }
  assert.equal(
    productSkuLookupResultSchema.safeParse(
      page({
        items: Array.from({ length: 5 }, () => item),
        page: 10,
        total: 101,
        hasNext: true,
      }),
    ).success,
    true,
  );
});
