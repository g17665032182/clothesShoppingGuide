import { EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

import {
  ProductCatalogImportService,
  ProductCatalogOrderService,
  productCatalogImportSchema,
} from '../../product-catalog/index.js';

const TEST_PRODUCTS = [
  {
    externalId: 'test-guide-top-knit-001',
    name: '测试款基础圆领针织衫',
    brand: '本地测试品牌',
    category: 'tops',
    description:
      '适合日常通勤的基础针织衫，用于验证品类、颜色、尺码和预算筛选。',
    styles: ['简约', '通勤'],
    occasions: ['通勤', '日常'],
    fits: ['常规'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-knit-ivory-s',
        color: '米白',
        size: 'S',
        price: '199.00',
        stock: 12,
      },
      {
        externalSkuId: 'test-knit-ivory-m',
        color: '米白',
        size: 'M',
        price: '199.00',
        stock: 8,
      },
      {
        externalSkuId: 'test-knit-black-m',
        color: '黑色',
        size: 'M',
        price: '219.00',
        stock: 0,
      },
    ],
  },
  {
    externalId: 'test-guide-top-shirt-002',
    name: '测试款棉质宽松衬衫',
    brand: '本地测试品牌',
    category: 'tops',
    description: '轻薄棉质衬衫，提供多色和多个尺码。',
    styles: ['休闲', '简约'],
    occasions: ['通勤', '日常'],
    fits: ['宽松'],
    productUrl: 'https://www.muji.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-shirt-blue-m',
        color: '浅蓝',
        size: 'M',
        price: '259.00',
        stock: 6,
      },
      {
        externalSkuId: 'test-shirt-blue-l',
        color: '浅蓝',
        size: 'L',
        price: '259.00',
        stock: 3,
      },
      {
        externalSkuId: 'test-shirt-white-m',
        color: '白色',
        size: 'M',
        price: '239.00',
        stock: 5,
      },
    ],
  },
  {
    externalId: 'test-guide-bottom-trousers-003',
    name: '测试款直筒通勤长裤',
    brand: '本地测试品牌',
    category: 'bottoms',
    description: '适合通勤搭配的直筒长裤。',
    styles: ['通勤', '简约'],
    occasions: ['通勤'],
    fits: ['直筒'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-trousers-black-s',
        color: '黑色',
        size: 'S',
        price: '299.00',
        stock: 4,
      },
      {
        externalSkuId: 'test-trousers-black-m',
        color: '黑色',
        size: 'M',
        price: '299.00',
        stock: 9,
      },
      {
        externalSkuId: 'test-trousers-grey-m',
        color: '灰色',
        size: 'M',
        price: '319.00',
        stock: 0,
      },
    ],
  },
  {
    externalId: 'test-guide-bottom-jeans-004',
    name: '测试款高腰直筒牛仔裤',
    brand: '本地测试品牌',
    category: 'bottoms',
    description: '日常休闲牛仔裤，适合测试库存不足和价格上限。',
    styles: ['休闲'],
    occasions: ['日常', '出游'],
    fits: ['直筒', '高腰'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-jeans-blue-m',
        color: '靛蓝',
        size: 'M',
        price: '399.00',
        stock: 7,
      },
      {
        externalSkuId: 'test-jeans-blue-l',
        color: '靛蓝',
        size: 'L',
        price: '399.00',
        stock: 0,
      },
      {
        externalSkuId: 'test-jeans-black-m',
        color: '黑色',
        size: 'M',
        price: '429.00',
        stock: 2,
      },
    ],
  },
  {
    externalId: 'test-guide-dress-midi-005',
    name: '测试款简约中长连衣裙',
    brand: '本地测试品牌',
    category: 'dresses',
    description: '适合日常和轻正式场合的中长连衣裙。',
    styles: ['简约', '轻熟'],
    occasions: ['日常', '约会'],
    fits: ['收腰'],
    productUrl: 'https://www.muji.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-dress-navy-s',
        color: '藏青',
        size: 'S',
        price: '459.00',
        stock: 5,
      },
      {
        externalSkuId: 'test-dress-navy-m',
        color: '藏青',
        size: 'M',
        price: '459.00',
        stock: 4,
      },
      {
        externalSkuId: 'test-dress-black-m',
        color: '黑色',
        size: 'M',
        price: '479.00',
        stock: 0,
      },
    ],
  },
  {
    externalId: 'test-guide-outerwear-coat-006',
    name: '测试款羊毛混纺通勤大衣',
    brand: '本地测试品牌',
    category: 'outerwear',
    description: '用于验证高预算范围、外套品类和尺码匹配。',
    styles: ['通勤', '简约'],
    occasions: ['通勤', '正式'],
    fits: ['直筒'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1548126032-079a0fb0099d?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-coat-camel-m',
        color: '驼色',
        size: 'M',
        price: '899.00',
        stock: 3,
      },
      {
        externalSkuId: 'test-coat-camel-l',
        color: '驼色',
        size: 'L',
        price: '899.00',
        stock: 1,
      },
      {
        externalSkuId: 'test-coat-black-m',
        color: '黑色',
        size: 'M',
        price: '929.00',
        stock: 0,
      },
    ],
  },
  {
    externalId: 'test-guide-outerwear-jacket-007',
    name: '测试款轻量防风夹克',
    brand: '本地测试品牌',
    category: 'outerwear',
    description: '适合日常出行的轻量外套。',
    styles: ['休闲', '运动'],
    occasions: ['日常', '出游'],
    fits: ['宽松'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-jacket-olive-s',
        color: '橄榄绿',
        size: 'S',
        price: '499.00',
        stock: 5,
      },
      {
        externalSkuId: 'test-jacket-olive-m',
        color: '橄榄绿',
        size: 'M',
        price: '499.00',
        stock: 7,
      },
      {
        externalSkuId: 'test-jacket-black-m',
        color: '黑色',
        size: 'M',
        price: '519.00',
        stock: 2,
      },
    ],
  },
  {
    externalId: 'test-guide-shoes-sneakers-008',
    name: '测试款日常轻便运动鞋',
    brand: '本地测试品牌',
    category: 'shoes',
    description: '轻便日常鞋款，尺码按字符串存储。',
    styles: ['休闲', '运动'],
    occasions: ['日常', '出游'],
    fits: ['常规'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-sneakers-white-38',
        color: '白色',
        size: '38',
        price: '359.00',
        stock: 6,
      },
      {
        externalSkuId: 'test-sneakers-white-39',
        color: '白色',
        size: '39',
        price: '359.00',
        stock: 4,
      },
      {
        externalSkuId: 'test-sneakers-black-40',
        color: '黑色',
        size: '40',
        price: '379.00',
        stock: 0,
      },
    ],
  },
] as const;

export class ProductCatalogTestSeeder extends Seeder {
  public async run(em: EntityManager): Promise<void> {
    const parsed = productCatalogImportSchema.parse({
      version: 1,
      products: TEST_PRODUCTS.map((product) => ({
        ...product,
        skus: product.skus.map((sku) => ({
          ...sku,
          imageUrl: product.imageUrl,
          isActive: true,
        })),
      })),
    });
    const catalog = new ProductCatalogOrderService();
    const importer = new ProductCatalogImportService();

    await em.transactional(async (transaction) => {
      const productIds = parsed.products.map((product) => product.externalId);
      const skuKeys = parsed.products.flatMap((product) =>
        product.skus.map((sku) => ({
          productExternalId: product.externalId,
          externalSkuId: sku.externalSkuId,
        })),
      );
      const identities = await catalog.getSkuIdsForCatalogChanges(
        transaction,
        productIds,
        skuKeys,
      );
      const snapshots = await catalog.lockSkus(
        transaction,
        identities.map((identity) => identity.skuId),
      );
      const reservations = await catalog.getReservedQuantities(
        transaction,
        identities.map((identity) => identity.skuId),
      );
      const identitiesByKey = new Map(
        identities.map((identity) => [
          `${identity.productExternalId}\u0000${identity.externalSkuId}`,
          identity,
        ]),
      );
      const snapshotsById = new Map(
        snapshots.map((snapshot) => [snapshot.skuId, snapshot]),
      );

      for (const product of parsed.products) {
        for (const sku of product.skus) {
          const identity = identitiesByKey.get(
            `${product.externalId}\u0000${sku.externalSkuId}`,
          );
          if (!identity) continue;
          const snapshot = snapshotsById.get(identity.skuId);
          if (!snapshot) throw new Error('商品 SKU 在测试 Seeder 中发生变化');
          if (sku.stock < (reservations.get(identity.skuId) ?? 0)) {
            throw new Error(
              `测试商品 ${product.externalId} 的 SKU ${sku.externalSkuId} 库存低于预占量`,
            );
          }
        }
      }

      await importer.upsertInTransaction(transaction, parsed.products);
    });
  }
}
