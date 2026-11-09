import { MikroORM } from '@mikro-orm/postgresql';
import { ConfigService } from '@nestjs/config';

import mikroOrmConfig from '../mikro-orm.config.js';
import { Product } from '../product-catalog/entity/product.entity.js';
import { ProductSku } from '../product-catalog/entity/product-sku.entity.js';
import { ProductTryOnImageProcessingService } from '../product-catalog/service/product-try-on-image-processing.service.js';
import { LocalProductTryOnImageStoreService } from '../product-catalog/service/local-product-try-on-image-store.service.js';
import { LocalPrivateObjectStorageService } from '../common/storage/local-private-object-storage.service.js';

const TRY_ON_KEY = /^product-try-on\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.webp$/iu;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

async function fetchTestCatalogImage(urlValue: string): Promise<Buffer> {
  const url = new URL(urlValue);
  if (url.protocol !== 'https:' || url.hostname !== 'images.unsplash.com')
    throw new Error('测试商品图片来源不符合白名单');
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`测试商品图片源返回 HTTP ${response.status}`);
  const declaredBytes = Number(response.headers.get('content-length'));
  if (
    !response.body ||
    (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_BYTES)
  )
    throw new Error('测试商品图片读取失败');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_SOURCE_BYTES)
    throw new Error('测试商品图片大小不符合要求');
  return bytes;
}

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.TRY_ON_STORAGE_DRIVER !== 'local'
  )
    throw new Error('该脚本只允许在本地 development 存储模式运行');

  const config = new ConfigService(process.env);
  const storage = new LocalPrivateObjectStorageService(config);
  const imageStore = new LocalProductTryOnImageStoreService(config, storage);
  const processing = new ProductTryOnImageProcessingService();
  const orm = await MikroORM.init(mikroOrmConfig);
  const imageCache = new Map<string, Buffer>();
  let restored = 0;
  let skipped = 0;
  const failedProducts: string[] = [];

  try {
    const entityManager = orm.em.fork();
    const products = await entityManager.find(Product, {
      externalId: { $like: 'test-guide-%' },
      tryOnImageKey: { $ne: null },
      isActive: true,
    });

    for (const product of products) {
      const keyMatch = product.tryOnImageKey?.match(TRY_ON_KEY);
      if (!keyMatch?.[1] || !keyMatch[2]) {
        skipped++;
        continue;
      }
      try {
        await imageStore.getObject(product.tryOnImageKey!);
        skipped++;
        continue;
      } catch {
        // 七牛对象无法在开发环境读取时，仅重建测试目录中的本地副本。
      }

      const sku = await entityManager.findOne(ProductSku, {
        productId: product.id,
        isActive: true,
        imageUrl: { $ne: null },
      });
      const sourceUrl = sku?.imageUrl;
      if (!sourceUrl) {
        skipped++;
        continue;
      }
      try {
        let source = imageCache.get(sourceUrl);
        if (!source) {
          source = await fetchTestCatalogImage(sourceUrl);
          imageCache.set(sourceUrl, source);
        }
        const body = await processing.normalize(source);
        const restoredKey = await imageStore.putImage({
          productId: keyMatch[1],
          assetId: keyMatch[2],
          body,
        });
        if (restoredKey !== product.tryOnImageKey)
          throw new Error('测试商品图片对象键不匹配');
        restored++;
        console.log(`已恢复测试商品试穿图：${product.externalId}`);
      } catch (error) {
        failedProducts.push(product.externalId);
        console.error(
          `测试商品图片恢复失败：${product.externalId}，${error instanceof Error ? error.message : '未知错误'}`,
        );
      }
    }
  } finally {
    await orm.close(true);
  }

  console.log(`本地试穿图恢复完成：${restored} 个，已存在/跳过 ${skipped} 个`);
  if (failedProducts.length)
    throw new Error(`仍有 ${failedProducts.length} 个测试商品图片待处理`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '本地试穿图恢复失败');
  process.exitCode = 1;
});
