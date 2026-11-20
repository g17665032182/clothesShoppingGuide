import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import qiniu from 'qiniu';

import { MAX_RETURN_REFUND_VIDEO_BYTES } from '../service/return-refund-evidence-file.js';
import type {
  ReturnRefundEvidenceExtension,
  ReturnRefundEvidenceStore,
} from '../port/return-refund-evidence-store.port.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID}$`, 'i');
const OBJECT_PREFIX = 'return-refund';
const UNAVAILABLE = '售后凭证存储暂不可用';
const EXTENSIONS: ReturnRefundEvidenceExtension[] = [
  'jpg',
  'png',
  'webp',
  'mp4',
];

@Injectable()
export class QiniuReturnRefundEvidenceStoreService implements ReturnRefundEvidenceStore {
  public constructor(private readonly configService: ConfigService) {
    qiniu.conf.RPC_TIMEOUT = 10_000;
  }

  public async put(input: {
    userId: string;
    applicationId: string;
    evidenceId: string;
    extension: ReturnRefundEvidenceExtension;
    body: Buffer;
  }): Promise<string> {
    if (
      !UUID_PATTERN.test(input.userId) ||
      !UUID_PATTERN.test(input.applicationId) ||
      !UUID_PATTERN.test(input.evidenceId) ||
      !EXTENSIONS.includes(input.extension) ||
      !Buffer.isBuffer(input.body) ||
      input.body.byteLength === 0 ||
      input.body.byteLength > MAX_RETURN_REFUND_VIDEO_BYTES
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    const key = `${OBJECT_PREFIX}/${input.userId}/${input.applicationId}/${input.evidenceId}.${input.extension}`;
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

  public async get(objectKey: string, maxBytes: number): Promise<Buffer> {
    this.assertKey(objectKey);
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > MAX_RETURN_REFUND_VIDEO_BYTES
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    try {
      const url = await this.privateDownloadUrl(objectKey, 60);
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok || !response.body) throw new Error('download failed');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
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

  public async delete(objectKey: string): Promise<void> {
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

  private async privateDownloadUrl(
    objectKey: string,
    ttlSeconds: number,
  ): Promise<string> {
    this.assertKey(objectKey);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300)
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

  private assertKey(key: string): void {
    const pattern = new RegExp(
      `^${OBJECT_PREFIX}/${UUID}/${UUID}/${UUID}\\.(?:jpg|png|webp|mp4)$`,
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
