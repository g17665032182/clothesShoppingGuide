import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import qiniu from 'qiniu';

import type { TryOnObjectStore } from '../port/try-on-object-store.port.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const USER_ID = new RegExp(`^${UUID}$`, 'i');
const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const UNAVAILABLE = '试穿对象存储暂不可用';
const OBJECT_PREFIX = 'try-on';
const MAX_OBJECT_BYTES = 10 * 1024 * 1024;

@Injectable()
export class QiniuTryOnObjectStoreService implements TryOnObjectStore {
  public constructor(private readonly configService: ConfigService) {
    // 七牛 SDK 默认超时较长，试穿任务不能被单个对象请求拖住。
    qiniu.conf.RPC_TIMEOUT = 10_000;
  }

  public async putPhoto(input: {
    userId: string;
    id: string;
    body: Buffer;
    mimeType: string;
  }): Promise<string> {
    return this.put(input, 'photos');
  }

  public async putResult(input: {
    userId: string;
    id: string;
    body: Buffer;
    mimeType: string;
  }): Promise<string> {
    return this.put(input, 'results');
  }

  public async getPrivateDownloadUrl(
    objectKey: string,
    ttlSeconds: number,
  ): Promise<string> {
    this.assertKey(objectKey);
    if (
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > 3600
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    try {
      const { mac, config, domain } = this.clients();
      return new qiniu.rs.BucketManager(mac, config).privateDownloadUrl(
        domain,
        objectKey,
        Math.floor(Date.now() / 1000) + ttlSeconds,
      );
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  public async getObject(objectKey: string): Promise<Buffer> {
    this.assertKey(objectKey);
    try {
      const url = await this.getPrivateDownloadUrl(objectKey, 60);
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok || !response.body) throw new Error('download failed');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      const maxBytes = MAX_OBJECT_BYTES;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          byteLength += value.byteLength;
          if (byteLength > maxBytes) {
            await reader.cancel();
            throw new Error('object too large');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks, byteLength);
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

  private async put(
    input: {
      userId: string;
      id: string;
      body: Buffer;
      mimeType: string;
    },
    kind: 'photos' | 'results',
  ): Promise<string> {
    if (
      !USER_ID.test(input.userId) ||
      !USER_ID.test(input.id) ||
      input.body.byteLength === 0
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    const extension = MIME_EXTENSION[input.mimeType];
    if (!extension) throw new ServiceUnavailableException(UNAVAILABLE);
    const key = `${OBJECT_PREFIX}/${input.userId}/${kind}/${input.id}.${extension}`;
    try {
      const { bucket, mac, config } = this.clients();
      const token = new qiniu.rs.PutPolicy({
        scope: `${bucket}:${key}`,
        expires: 60,
        insertOnly: 1,
      }).uploadToken(mac);
      const result = await new qiniu.form_up.FormUploader(config).put(
        token,
        key,
        input.body,
        new qiniu.form_up.PutExtra(),
      );
      if (!result.ok()) throw new Error('upload failed');
      return key;
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  private assertKey(key: string): void {
    const pattern = new RegExp(
      `^${OBJECT_PREFIX}/${UUID}/(?:photos|results)/${UUID}\\.(?:jpg|png|webp)$`,
      'i',
    );
    if (!pattern.test(key)) throw new ServiceUnavailableException(UNAVAILABLE);
  }

  private clients(): {
    bucket: string;
    domain: string;
    mac: qiniu.auth.digest.Mac;
    config: qiniu.conf.Config;
  } {
    const value = (name: string) =>
      this.configService.get<string>(name)?.trim();
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
      mac: new qiniu.auth.digest.Mac(accessKey, secretKey),
      config,
    };
  }
}
