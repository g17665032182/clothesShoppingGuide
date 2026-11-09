import assert from 'node:assert/strict';
import test from 'node:test';

import { ProductCatalogTryOnService } from '../service/product-catalog-try-on.service.js';

function createService(rows: unknown[]) {
  const repository = {
    getEntityManager: () => ({
      getConnection: () => ({
        execute: async () => rows,
      }),
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
      color: '深灰',
      image_url: null,
    },
    {
      product_external_id: 'coat-1',
      product_name: '羊毛大衣',
      category: 'outerwear',
      color: '深灰',
      image_url: 'https://images.example.org/gray.webp',
    },
    {
      product_external_id: 'coat-1',
      product_name: '羊毛大衣',
      category: 'outerwear',
      color: '米白',
      image_url: 'https://images.example.org/white.webp',
    },
  ]);

  assert.deepEqual(await service.getTryOnProduct('coat-1'), {
    productExternalId: 'coat-1',
    productName: '羊毛大衣',
    category: 'outerwear',
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
      color: '深灰',
      image_url: 'http://127.0.0.1/private',
    },
  ]);

  assert.deepEqual(await service.getTryOnProduct('coat-1'), {
    productExternalId: 'coat-1',
    productName: '羊毛大衣',
    category: 'outerwear',
    mainImageUrl: null,
    colors: [{ color: '深灰', imageUrl: null }],
  });
});
