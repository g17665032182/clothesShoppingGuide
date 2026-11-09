import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import qiniu from 'qiniu';

import type { ProductTryOnImageStore } from '../port/product-try-on-image-store.port.js';
import { PRODUCT_TRY_ON_MAX_BYTES } from './product-try-on-image-processing.service.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ID_PATTERN = new RegExp(`^${UUID}$`, 'i');
const KEY_PATTERN = new RegExp(`^product-try-on/${UUID}/${UUID}\\.webp$`, 'i');
const UNAVAILABLE = '商品试穿图片存储暂不可用';

@Injectable()
export class QiniuProductTryOnImageStoreService implements ProductTryOnImageStore {
  public constructor(private readonly config: ConfigService) {
    qiniu.conf.RPC_TIMEOUT = 10_000;
  }

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
      throw new ServiceUnavailableException(UNAVAILABLE);
    const key = `product-try-on/${input.productId}/${input.assetId}.webp`;
    try {
      const { bucket, mac, config } = this.clients();
      const token = new qiniu.rs.PutPolicy({
        scope: `${bucket}:${key}`,
        expires: 60,
        insertOnly: 1,
      }).uploadToken(mac);
      const extra = new qiniu.form_up.PutExtra();
      extra.mimeType = 'image/webp';
      const result = await new qiniu.form_up.FormUploader(config).put(
        token,
        key,
        input.body,
        extra,
      );
      if (!result.ok()) throw new Error('upload failed');
      return key;
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  public async getObject(objectKey: string): Promise<Buffer> {
    this.assertKey(objectKey);
    try {
      const { mac, config, domain } = this.clients();
      // 签名仅供后端短时读取；不将私有 URL 返回前端或传给生成供应商。
      const url = new qiniu.rs.BucketManager(mac, config).privateDownloadUrl(
        domain,
        objectKey,
        Math.floor(Date.now() / 1000) + 60,
      );
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok || !response.body) throw new Error('download failed');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > PRODUCT_TRY_ON_MAX_BYTES) {
            await reader.cancel();
            throw new Error('image too large');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks, length);
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  public async deleteObject(objectKey: string): Promise<void> {
    this.assertKey(objectKey);
    try {
      const { bucket, mac, config } = this.clients();
      const result = await new qiniu.rs.BucketManager(mac, config).delete(
        bucket,
        objectKey,
      );
      if (!result.ok() && result.resp.statusCode !== 612)
        throw new Error('delete failed');
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  private assertKey(key: string): void {
    // 不允许此端口访问人像、结果或其他七牛对象。
    if (!KEY_PATTERN.test(key))
      throw new ServiceUnavailableException(UNAVAILABLE);
  }

  private clients() {
    const value = (name: string) => this.config.get<string>(name)?.trim();
    const accessKey = value('QINIU_ACCESS_KEY');
    const secretKey = value('QINIU_SECRET_KEY');
    const bucket = value('QINIU_BUCKET');
    const domain = value('QINIU_DOMAIN');
    const region = value('QINIU_REGION');
    if (!accessKey || !secretKey || !bucket || !domain)
      throw new Error('missing configuration');
    const parsed = new URL(domain);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('invalid domain');
    const config = new qiniu.conf.Config({ useHttpsDomain: true });
    if (region)
      config.regionsProvider = qiniu.httpc.Region.fromRegionId(region);
    return {
      bucket,
      domain: parsed.origin,
      config,
      mac: new qiniu.auth.digest.Mac(accessKey, secretKey),
    };
  }
}
