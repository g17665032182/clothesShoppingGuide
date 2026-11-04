import { randomUUID } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import qiniu from 'qiniu';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const USER_ID = new RegExp(`^${UUID}$`, 'i');
const OBJECT_KEY = new RegExp(
  `^user-memory/${UUID}/[1-9][0-9]*-${UUID}\\.md$`,
  'i',
);
const UNAVAILABLE = '记忆文档存储暂不可用';

@Injectable()
export class UserMemoryDocumentStoreService {
  constructor(private readonly configService: ConfigService) {
    // 七牛上传默认等待十分钟；通过 SDK 公开配置收紧实际网络超时。
    qiniu.conf.RPC_TIMEOUT = 10_000;
  }

  async putRevision(
    userId: string,
    revision: number,
    content: string,
  ): Promise<string> {
    if (
      !USER_ID.test(userId) ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    ) {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }

    const key = `user-memory/${userId}/${revision}-${randomUUID()}.md`;
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
        Buffer.from(content, 'utf8'),
        new qiniu.form_up.PutExtra(),
      );
      if (!result.ok()) throw new Error('upload failed');
      return key;
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  async readObject(objectKey: string): Promise<Buffer> {
    this.assertKey(objectKey);
    try {
      const { mac, config, domain } = this.clients();
      const manager = new qiniu.rs.BucketManager(mac, config);
      const url = manager.privateDownloadUrl(
        domain,
        objectKey,
        Math.floor(Date.now() / 1000) + 60,
      );
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('download failed');
      return Buffer.from(await response.arrayBuffer());
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    this.assertKey(objectKey);
    try {
      const { bucket, mac, config } = this.clients();
      const result = await new qiniu.rs.BucketManager(mac, config).delete(
        bucket,
        objectKey,
      );
      // 对象不存在时清理已完成，可安全重试。
      if (!result.ok() && result.resp.statusCode !== 612)
        throw new Error('delete failed');
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  async listObjects(
    marker?: string,
  ): Promise<{ items: { key: string; uploadedAt: Date }[]; marker?: string }> {
    try {
      const { bucket, mac, config } = this.clients();
      const result = await new qiniu.rs.BucketManager(mac, config).listPrefix(
        bucket,
        {
          prefix: 'user-memory/',
          limit: 100,
          ...(marker ? { marker } : {}),
        },
      );
      if (!result.ok() || !Array.isArray(result.data.items))
        throw new Error('list failed');
      const items = result.data.items.flatMap((item) => {
        const uploadedAt = new Date(item.putTime / 10_000);
        return typeof item.key === 'string' &&
          OBJECT_KEY.test(item.key) &&
          Number.isFinite(item.putTime) &&
          item.putTime > 0 &&
          Number.isFinite(uploadedAt.getTime())
          ? [{ key: item.key, uploadedAt }]
          : [];
      });
      return {
        items,
        ...(result.data.marker ? { marker: result.data.marker } : {}),
      };
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  private assertKey(key: string): void {
    if (!OBJECT_KEY.test(key))
      throw new ServiceUnavailableException(UNAVAILABLE);
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
    ) {
      throw new Error('invalid domain');
    }
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
