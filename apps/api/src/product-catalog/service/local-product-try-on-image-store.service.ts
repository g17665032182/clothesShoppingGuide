import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LocalPrivateObjectStorageService } from '../../common/storage/local-private-object-storage.service.js';
import type { ProductTryOnImageStore } from '../port/product-try-on-image-store.port.js';
import { PRODUCT_TRY_ON_MAX_BYTES } from './product-try-on-image-processing.service.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ID_PATTERN = new RegExp(`^${UUID}$`, 'i');
const KEY_PATTERN = new RegExp(`^product-try-on/${UUID}/${UUID}\\.webp$`, 'i');

@Injectable()
export class LocalProductTryOnImageStoreService implements ProductTryOnImageStore {
  public constructor(
    private readonly config: ConfigService,
    private readonly storage: LocalPrivateObjectStorageService,
  ) {}

  public async putImage(input: {
    productId: string;
    assetId: string;
    body: Buffer;
  }): Promise<string> {
    if (
      !ID_PATTERN.test(input.productId) ||
      !ID_PATTERN.test(input.assetId) ||
      !input.body.byteLength ||
      input.body.byteLength > PRODUCT_TRY_ON_MAX_BYTES
    )
      throw this.unavailable();

    const key = `product-try-on/${input.productId}/${input.assetId}.webp`;
    try {
      this.assertEnabled();
      await this.storage.put(key, input.body);
      return key;
    } catch {
      throw this.unavailable();
    }
  }

  public async getObject(objectKey: string): Promise<Buffer> {
    this.assertKey(objectKey);
    try {
      this.assertEnabled();
      return await this.storage.get(objectKey);
    } catch {
      throw this.unavailable();
    }
  }

  public async deleteObject(objectKey: string): Promise<void> {
    this.assertKey(objectKey);
    try {
      this.assertEnabled();
      await this.storage.delete(objectKey);
    } catch {
      throw this.unavailable();
    }
  }

  private assertEnabled(): void {
    if (
      this.config.get<string>('TRY_ON_STORAGE_DRIVER') !== 'local' ||
      this.config.get<string>('NODE_ENV') !== 'development'
    )
      throw new Error('local storage is development-only');
  }

  private assertKey(key: string): void {
    if (!KEY_PATTERN.test(key)) throw this.unavailable();
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException('商品试穿图片存储暂不可用');
  }
}
