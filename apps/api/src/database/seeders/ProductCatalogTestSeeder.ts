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
        price: 199,
        stock: 12,
      },
      {
        externalSkuId: 'test-knit-ivory-m',
        color: '米白',
        size: 'M',
        price: 199,
        stock: 8,
      },
      {
        externalSkuId: 'test-knit-black-m',
        color: '黑色',
        size: 'M',
        price: 219,
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
        price: 259,
        stock: 6,
      },
      {
        externalSkuId: 'test-shirt-blue-l',
        color: '浅蓝',
        size: 'L',
        price: 259,
        stock: 3,
      },
      {
        externalSkuId: 'test-shirt-white-m',
        color: '白色',
        size: 'M',
        price: 239,
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
        price: 299,
        stock: 4,
      },
      {
        externalSkuId: 'test-trousers-black-m',
        color: '黑色',
        size: 'M',
        price: 299,
        stock: 9,
      },
      {
        externalSkuId: 'test-trousers-grey-m',
        color: '灰色',
        size: 'M',
        price: 319,
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
        price: 399,
        stock: 7,
      },
      {
        externalSkuId: 'test-jeans-blue-l',
        color: '靛蓝',
        size: 'L',
        price: 399,
        stock: 0,
      },
      {
        externalSkuId: 'test-jeans-black-m',
        color: '黑色',
        size: 'M',
        price: 429,
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
        price: 459,
        stock: 5,
      },
      {
        externalSkuId: 'test-dress-navy-m',
        color: '藏青',
        size: 'M',
        price: 459,
        stock: 4,
      },
      {
        externalSkuId: 'test-dress-black-m',
        color: '黑色',
        size: 'M',
        price: 479,
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
        price: 899,
        stock: 3,
      },
      {
        externalSkuId: 'test-coat-camel-l',
        color: '驼色',
        size: 'L',
        price: 899,
        stock: 1,
      },
      {
        externalSkuId: 'test-coat-black-m',
        color: '黑色',
        size: 'M',
        price: 929,
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
        price: 499,
        stock: 5,
      },
      {
        externalSkuId: 'test-jacket-olive-m',
        color: '橄榄绿',
        size: 'M',
        price: 499,
        stock: 7,
      },
      {
        externalSkuId: 'test-jacket-black-m',
        color: '黑色',
        size: 'M',
        price: 519,
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
        price: 359,
        stock: 6,
      },
      {
        externalSkuId: 'test-sneakers-white-39',
        color: '白色',
        size: '39',
        price: 359,
        stock: 4,
      },
      {
        externalSkuId: 'test-sneakers-black-40',
        color: '黑色',
        size: '40',
        price: 379,
        stock: 0,
      },
    ],
  },
  // 每个品类补充到四个商品，覆盖筛选、分页、价格区间和无库存场景。
  {
    externalId: 'test-guide-top-hoodie-009',
    name: '测试款连帽卫衣',
    brand: '本地测试品牌',
    category: 'tops',
    description: '适合休闲和出游场景的连帽卫衣。',
    styles: ['休闲', '运动'],
    occasions: ['日常', '出游'],
    fits: ['宽松'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-hoodie-grey-s',
        color: '浅灰',
        size: 'S',
        price: 329,
        stock: 10,
      },
      {
        externalSkuId: 'test-hoodie-grey-m',
        color: '浅灰',
        size: 'M',
        price: 329,
        stock: 8,
      },
      {
        externalSkuId: 'test-hoodie-green-l',
        color: '深绿',
        size: 'L',
        price: 349,
        stock: 0,
      },
    ],
  },
  {
    externalId: 'test-guide-top-polo-010',
    name: '测试款珠地棉短袖 POLO',
    brand: '本地测试品牌',
    category: 'tops',
    description: '适合通勤和日常穿着的短袖 POLO 衫。',
    styles: ['简约', '通勤'],
    occasions: ['通勤', '日常'],
    fits: ['常规'],
    productUrl: 'https://www.muji.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1625910513413-5fc45c4f7c8a?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-polo-white-m',
        color: '白色',
        size: 'M',
        price: 229,
        stock: 11,
      },
      {
        externalSkuId: 'test-polo-navy-l',
        color: '藏青',
        size: 'L',
        price: 239,
        stock: 5,
      },
    ],
  },
  {
    externalId: 'test-guide-bottom-skirt-011',
    name: '测试款高腰 A 字半身裙',
    brand: '本地测试品牌',
    category: 'bottoms',
    description: '适合通勤和约会搭配的高腰半身裙。',
    styles: ['通勤', '轻熟'],
    occasions: ['通勤', '约会'],
    fits: ['A字', '高腰'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1583496661160-fb5886a13d27?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-skirt-khaki-s',
        color: '卡其',
        size: 'S',
        price: 279,
        stock: 6,
      },
      {
        externalSkuId: 'test-skirt-khaki-m',
        color: '卡其',
        size: 'M',
        price: 279,
        stock: 4,
      },
      {
        externalSkuId: 'test-skirt-black-m',
        color: '黑色',
        size: 'M',
        price: 289,
        stock: 0,
      },
    ],
  },
  {
    externalId: 'test-guide-bottom-shorts-012',
    name: '测试款轻薄五分休闲短裤',
    brand: '本地测试品牌',
    category: 'bottoms',
    description: '适合夏季日常和户外活动的休闲短裤。',
    styles: ['休闲', '运动'],
    occasions: ['日常', '出游'],
    fits: ['宽松'],
    productUrl: null,
    imageUrl:
      'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-shorts-beige-m',
        color: '米色',
        size: 'M',
        price: 189,
        stock: 14,
      },
      {
        externalSkuId: 'test-shorts-black-l',
        color: '黑色',
        size: 'L',
        price: 199,
        stock: 9,
      },
    ],
  },
  {
    externalId: 'test-guide-dress-shirt-013',
    name: '测试款中长款衬衫连衣裙',
    brand: '本地测试品牌',
    category: 'dresses',
    description: '可单穿也可叠搭的衬衫连衣裙。',
    styles: ['简约', '通勤'],
    occasions: ['通勤', '日常'],
    fits: ['直筒'],
    productUrl: 'https://www.muji.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1591369822096-ffd140ec948f?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-shirt-dress-blue-s',
        color: '浅蓝',
        size: 'S',
        price: 389,
        stock: 7,
      },
      {
        externalSkuId: 'test-shirt-dress-blue-m',
        color: '浅蓝',
        size: 'M',
        price: 389,
        stock: 6,
      },
    ],
  },
  {
    externalId: 'test-guide-dress-knit-014',
    name: '测试款针织修身连衣裙',
    brand: '本地测试品牌',
    category: 'dresses',
    description: '适合约会和轻正式场合的针织连衣裙。',
    styles: ['轻熟', '简约'],
    occasions: ['约会', '正式'],
    fits: ['修身'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-knit-dress-brown-m',
        color: '棕色',
        size: 'M',
        price: 529,
        stock: 3,
      },
      {
        externalSkuId: 'test-knit-dress-brown-l',
        color: '棕色',
        size: 'L',
        price: 529,
        stock: 2,
      },
      {
        externalSkuId: 'test-knit-dress-cream-m',
        color: '奶油白',
        size: 'M',
        price: 549,
        stock: 0,
      },
    ],
  },
  {
    externalId: 'test-guide-dress-linen-015',
    name: '测试款亚麻系带长裙',
    brand: null,
    category: 'dresses',
    description: '适合夏季日常穿着的亚麻系带长裙。',
    styles: ['自然', '休闲'],
    occasions: ['日常', '出游'],
    fits: ['宽松'],
    productUrl: null,
    imageUrl:
      'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-linen-dress-white-s',
        color: '白色',
        size: 'S',
        price: 429,
        stock: 5,
      },
      {
        externalSkuId: 'test-linen-dress-white-m',
        color: '白色',
        size: 'M',
        price: 429,
        stock: 5,
      },
    ],
  },
  {
    externalId: 'test-guide-outerwear-trench-016',
    name: '测试款防泼水风衣',
    brand: '本地测试品牌',
    category: 'outerwear',
    description: '适合换季通勤的中长款风衣。',
    styles: ['通勤', '简约'],
    occasions: ['通勤', '出游'],
    fits: ['直筒'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-trench-khaki-m',
        color: '卡其',
        size: 'M',
        price: 699,
        stock: 5,
      },
      {
        externalSkuId: 'test-trench-khaki-l',
        color: '卡其',
        size: 'L',
        price: 699,
        stock: 4,
      },
    ],
  },
  {
    externalId: 'test-guide-outerwear-down-017',
    name: '测试款轻薄羽绒服',
    brand: '本地测试品牌',
    category: 'outerwear',
    description: '适合冬季通勤和户外活动的轻薄羽绒服。',
    styles: ['休闲', '运动'],
    occasions: ['日常', '出游'],
    fits: ['常规'],
    productUrl: 'https://www.muji.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1548883354-7622d03aca27?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-down-black-m',
        color: '黑色',
        size: 'M',
        price: 799,
        stock: 8,
      },
      {
        externalSkuId: 'test-down-black-l',
        color: '黑色',
        size: 'L',
        price: 799,
        stock: 6,
      },
      {
        externalSkuId: 'test-down-white-m',
        color: '米白',
        size: 'M',
        price: 829,
        stock: 0,
      },
    ],
  },
  {
    externalId: 'test-guide-shoes-loafers-018',
    name: '测试款通勤乐福鞋',
    brand: '本地测试品牌',
    category: 'shoes',
    description: '适合通勤和轻正式场合的乐福鞋。',
    styles: ['通勤', '简约'],
    occasions: ['通勤', '正式'],
    fits: ['常规'],
    productUrl: 'https://www.uniqlo.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1533867617858-e7b97e060509?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-loafers-black-38',
        color: '黑色',
        size: '38',
        price: 429,
        stock: 6,
      },
      {
        externalSkuId: 'test-loafers-black-39',
        color: '黑色',
        size: '39',
        price: 429,
        stock: 4,
      },
    ],
  },
  {
    externalId: 'test-guide-shoes-boots-019',
    name: '测试款短筒切尔西靴',
    brand: '本地测试品牌',
    category: 'shoes',
    description: '适合秋冬日常搭配的短筒靴。',
    styles: ['简约', '轻熟'],
    occasions: ['日常', '约会'],
    fits: ['常规'],
    productUrl: 'https://www.muji.com/',
    imageUrl:
      'https://images.unsplash.com/photo-1608256246200-53e635b5b65f?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-boots-brown-38',
        color: '棕色',
        size: '38',
        price: 599,
        stock: 3,
      },
      {
        externalSkuId: 'test-boots-brown-39',
        color: '棕色',
        size: '39',
        price: 599,
        stock: 2,
      },
      {
        externalSkuId: 'test-boots-black-40',
        color: '黑色',
        size: '40',
        price: 619,
        stock: 0,
      },
    ],
  },
  {
    externalId: 'test-guide-shoes-sandals-020',
    name: '测试款简约一字带凉鞋',
    brand: null,
    category: 'shoes',
    description: '适合夏季日常和度假的简约凉鞋。',
    styles: ['休闲'],
    occasions: ['日常', '出游'],
    fits: ['常规'],
    productUrl: null,
    imageUrl:
      'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=640&q=80',
    skus: [
      {
        externalSkuId: 'test-sandals-beige-37',
        color: '米色',
        size: '37',
        price: 259,
        stock: 9,
      },
      {
        externalSkuId: 'test-sandals-beige-38',
        color: '米色',
        size: '38',
        price: 259,
        stock: 7,
      },
    ],
  },
] as const;

export class ProductCatalogTestSeeder extends Seeder {
  public async run(em: EntityManager): Promise<void> {
    const parsed = productCatalogImportSchema.parse({
      version: 1,
      products: TEST_PRODUCTS.map(({ imageUrl, ...product }) => ({
        // 商品主图由导入器写入 SKU 图片，避免把扩展字段带入严格商品 Schema。
        ...product,
        skus: product.skus.map((sku) => ({
          ...sku,
          imageUrl,
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
