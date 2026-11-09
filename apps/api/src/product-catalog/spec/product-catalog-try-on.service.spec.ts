import assert from 'node:assert/strict';
import test from 'node:test';

import { ProductCatalogTryOnService } from '../service/product-catalog-try-on.service.js';

function createService(rows: unknown[]) {
  const repository = {
    getEntityManager: () => ({
      getConnection: () => ({
        execute: async () => rows,
      }),
      getTransactionContext: () => undefined,
    }),
  };
  return new ProductCatalogTryOnService(repository as never);
}

test('试穿商品投影按颜色稳定去重并选择首个可用图片', async () => {
  const service = createService([
    {
      product_external_id: 'coat-1',
      product_name: '羊毛大衣',
      category: 'outerwear',
      try_on_enabled: true,
      color: '深灰',
      image_url: null,
    },
    {
      product_external_id: 'coat-1',
      product_name: '羊毛大衣',
      category: 'outerwear',
      try_on_enabled: true,
      color: '深灰',
      image_url: 'https://images.example.org/gray.webp',
    },
    {
      product_external_id: 'coat-1',
      product_name: '羊毛大衣',
      category: 'outerwear',
      try_on_enabled: true,
      color: '米白',
      image_url: 'https://images.example.org/white.webp',
    },
  ]);

  assert.deepEqual(await service.getTryOnProduct('coat-1'), {
    productExternalId: 'coat-1',
    productName: '羊毛大衣',
    category: 'outerwear',
    tryOnEnabled: true,
    tryOnEligible: true,
    tryOnImageObjectKey: null,
    mainImageUrl: 'https://images.example.org/gray.webp',
    colors: [
      { color: '深灰', imageUrl: 'https://images.example.org/gray.webp' },
      { color: '米白', imageUrl: 'https://images.example.org/white.webp' },
    ],
  });
});

test('商品不存在时返回 null', async () => {
  const service = createService([]);
  assert.equal(await service.getTryOnProduct('missing'), null);
});

test('不安全商品图片不会进入试穿投影', async () => {
  const service = createService([
    {
      product_external_id: 'coat-1',
      product_name: '羊毛大衣',
      category: 'outerwear',
      try_on_enabled: true,
      color: '深灰',
      image_url: 'http://127.0.0.1/private',
    },
  ]);

  assert.deepEqual(await service.getTryOnProduct('coat-1'), {
    productExternalId: 'coat-1',
    productName: '羊毛大衣',
    category: 'outerwear',
    tryOnEnabled: true,
    tryOnEligible: false,
    tryOnImageObjectKey: null,
    mainImageUrl: null,
    colors: [{ color: '深灰', imageUrl: null }],
  });
});

test('批量资格独立于管理员开关与库存，鞋类和空颜色始终不具资格', async () => {
  const service = createService([
    {
      product_external_id: 'tops',
      product_name: '上装',
      category: 'tops',
      try_on_enabled: false,
      color: ' 黑色 ',
      image_url: 'https://images.example.org/black.webp',
    },
    {
      product_external_id: 'shoes',
      product_name: '鞋',
      category: 'shoes',
      try_on_enabled: true,
      color: '黑色',
      image_url: 'https://images.example.org/shoes.webp',
    },
    {
      product_external_id: 'empty',
      product_name: '无颜色',
      category: 'tops',
      try_on_enabled: true,
      color: ' ',
      image_url: 'https://images.example.org/empty.webp',
    },
  ]);
  const result = await service.getTryOnProducts(['tops', 'shoes', 'empty']);
  assert.equal(result.get('tops')?.tryOnEnabled, false);
  assert.equal(result.get('tops')?.tryOnEligible, true);
  assert.equal(result.get('tops')?.colors[0]?.color, '黑色');
  assert.equal(result.get('shoes')?.tryOnEligible, false);
  assert.equal(result.get('empty')?.tryOnEligible, false);
});

test('无图颜色可以回退商品主图；批量查询去重、空集合跳过且拒绝超限', async () => {
  const calls: unknown[][] = [];
  const service = new ProductCatalogTryOnService({
    getEntityManager: () => ({
      getTransactionContext: () => undefined,
      getConnection: () => ({
        execute: async (...args: unknown[]) => {
          calls.push(args);
          return [
            {
              product_external_id: 'tops',
              product_name: '上装',
              category: 'tops',
              try_on_enabled: true,
              color: '白色',
              image_url: null,
            },
            {
              product_external_id: 'tops',
              product_name: '上装',
              category: 'tops',
              try_on_enabled: true,
              color: '黑色',
              image_url: 'https://images.example.org/black.webp',
            },
          ];
        },
      }),
    }),
  } as never);
  assert.equal((await service.getTryOnProducts([])).size, 0);
  assert.equal(calls.length, 0);
  const product = (await service.getTryOnProducts(['tops', 'tops'])).get(
    'tops',
  );
  assert.equal(product?.tryOnEligible, true);
  assert.equal(product?.tryOnImageObjectKey, null);
  assert.equal(product?.colors[0]?.imageUrl, null);
  assert.equal(product?.mainImageUrl, 'https://images.example.org/black.webp');
  assert.deepEqual(calls[0]?.[1], ['tops']);
  await assert.rejects(
    service.getTryOnProducts(
      Array.from({ length: 201 }, (_, index) => String(index)),
    ),
    /商品批量查询超过上限/u,
  );
  assert.equal(calls.length, 1);
});
