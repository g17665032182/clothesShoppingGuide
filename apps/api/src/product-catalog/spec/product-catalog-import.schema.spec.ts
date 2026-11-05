import assert from 'node:assert/strict';
import test from 'node:test';

import { productCatalogImportSchema } from '../import/product-catalog-import.schema.js';
import { publicProductUrl } from '../public-url.js';
import { productSearchSchema } from '../service/product-catalog.service.js';
import { createProductSearchTool } from '../tool/product-search.tool.js';

const validCatalog = {
  version: 1,
  products: [
    {
      externalId: 'coat-1',
      name: '羊毛大衣',
      category: 'outerwear',
      audience: 'adult',
      productUrl: 'https://shop.example.com/products/coat-1',
      skus: [
        {
          externalSkuId: 'coat-1-black-m',
          color: '黑色',
          size: 'M',
          price: 899,
          stock: 4,
        },
      ],
    },
  ],
};

test('商品目录导入接受合法商品，并应用已约定默认值', () => {
  const parsed = productCatalogImportSchema.parse(validCatalog);
  assert.equal(parsed.products[0]?.isActive, true);
  assert.equal(parsed.products[0]?.skus[0]?.isActive, true);
  assert.deepEqual(parsed.products[0]?.styles, []);
});

test('商品目录导入拒绝未知字段、重复外部标识和内网 URL', () => {
  assert.equal(
    productCatalogImportSchema.safeParse({
      ...validCatalog,
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    productCatalogImportSchema.safeParse({
      version: 1,
      products: [validCatalog.products[0], validCatalog.products[0]],
    }).success,
    false,
  );
  assert.equal(
    productCatalogImportSchema.safeParse({
      version: 1,
      products: [
        {
          ...validCatalog.products[0],
          productUrl: 'http://127.0.0.1/admin',
        },
      ],
    }).success,
    false,
  );
  assert.equal(publicProductUrl('http://[::1]/private'), null);
  assert.equal(publicProductUrl('https://user:pass@example.com'), null);
  assert.equal(
    publicProductUrl('https://shop.example.com/item')?.hostname,
    'shop.example.com',
  );
});

test('商品 SKU 重复标识在整份目录预校验时拒绝', () => {
  const product = validCatalog.products[0]!;
  assert.equal(
    productCatalogImportSchema.safeParse({
      version: 1,
      products: [
        {
          ...product,
          skus: [product.skus[0], product.skus[0]],
        },
      ],
    }).success,
    false,
  );
});

test('商品查询工具参数使用严格 schema 和约定分页默认值', () => {
  assert.equal(productSearchSchema.parse({}).limit, 3);
  assert.equal(
    productSearchSchema.safeParse({
      size: 'M',
      limit: 21,
    }).success,
    false,
  );
  assert.equal(
    productSearchSchema.safeParse({
      size: 'M',
      userId: 'model-controlled-user',
    }).success,
    false,
  );
});

test('商品查询工具每轮只搜索一次并忽略模型要求的较大页数', async () => {
  const limits: number[] = [];
  const catalog = {
    async search(input: { limit: number }) {
      limits.push(input.limit);
      return { items: [], nextCursor: null, noResultReason: null };
    },
  };
  const searchTool = createProductSearchTool(catalog as never);

  await searchTool.invoke({ size: 'M', limit: 20 });
  const blockedPage = await searchTool.invoke({ size: 'L', limit: 20 });
  assert.deepEqual(limits, [3]);
  assert.deepEqual(JSON.parse(String(blockedPage)), {
    items: [],
    nextCursor: null,
    noResultReason: null,
  });
});
