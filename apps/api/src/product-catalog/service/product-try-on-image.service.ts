import { randomUUID } from 'node:crypto';
import { LockMode } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityRepository } from '@mikro-orm/postgresql';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { Product } from '../entity/product.entity.js';
import {
  PRODUCT_TRY_ON_IMAGE_STORE,
  type ProductTryOnImageStore,
} from '../port/product-try-on-image-store.port.js';
import { ProductTryOnImageProcessingService } from './product-try-on-image-processing.service.js';

@Injectable()
export class ProductTryOnImageService {
  private readonly logger = new Logger(ProductTryOnImageService.name);

  public constructor(
    @InjectRepository(Product)
    private readonly products: EntityRepository<Product>,
    @Inject(PRODUCT_TRY_ON_IMAGE_STORE)
    private readonly store: ProductTryOnImageStore,
    @Inject(ProductTryOnImageProcessingService)
    private readonly processing: ProductTryOnImageProcessingService,
  ) {}

  public async upload(id: string, file?: { buffer: Buffer }): Promise<void> {
    const body = await this.processing.normalize(file?.buffer);
    let uploadedKey: string | undefined;
    try {
      await this.products
        .getEntityManager()
        .fork()
        .transactional(async (transaction) => {
          // 单商品上传串行化；重复上传不能覆盖任务已经引用的私有图片。
          const product = await transaction.findOne(
            Product,
            { id },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          );
          if (!product) throw new NotFoundException('商品不存在');
          if (product.tryOnImageKey)
            throw new ConflictException('该商品已上传试穿图片');
          uploadedKey = await this.store.putImage({
            productId: id,
            assetId: randomUUID(),
            body,
          });
          product.tryOnImageKey = uploadedKey;
          product.updatedAt = new Date();
          await transaction.flush();
        });
    } catch (error) {
      if (uploadedKey) {
        try {
          await this.store.deleteObject(uploadedKey);
        } catch {
          this.logger.warn({ code: 'PRODUCT_IMAGE_COMPENSATION_FAILED' });
        }
      }
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      )
        throw error;
      throw new ServiceUnavailableException(
        '商品试穿图片保存失败，请重新读取状态后重试',
      );
    }
  }

  public async preview(id: string): Promise<Buffer> {
    const product = await this.products
      .getEntityManager()
      .fork()
      .findOne(Product, { id });
    if (!product) throw new NotFoundException('商品不存在');
    if (!product.tryOnImageKey)
      throw new NotFoundException('商品尚未上传试穿图片');
    return this.store.getObject(product.tryOnImageKey);
  }
}
