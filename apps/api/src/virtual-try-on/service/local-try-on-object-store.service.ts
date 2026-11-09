import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import type { TryOnObjectStore } from '../port/try-on-object-store.port.js';
import { LocalPrivateObjectStorageService } from '../../common/storage/local-private-object-storage.service.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const USER_ID = new RegExp(`^${UUID}$`, 'i');
const KEY_PATTERN = new RegExp(
  `^try-on/${UUID}/(?:photos|results)/${UUID}\\.(?:jpg|png|webp)$`,
  'i',
);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const MAX_OBJECT_BYTES = 10 * 1024 * 1024;
const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const UNAVAILABLE = '试穿对象存储暂不可用';

type DownloadPayload = { key: string; expiresAt: number };

@Injectable()
export class LocalTryOnObjectStoreService implements TryOnObjectStore {
  public constructor(
    private readonly config: ConfigService,
    private readonly storage: LocalPrivateObjectStorageService,
  ) {}

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

  public async getObject(objectKey: string): Promise<Buffer> {
    this.assertKey(objectKey);
    try {
      this.assertEnabled();
      return await this.storage.get(objectKey);
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
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
    this.assertEnabled();

    const payload: DownloadPayload = {
      key: objectKey,
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    // 令牌同时加密对象键并校验篡改，浏览器无法从短期下载地址还原存储键。
    const token = this.encrypt(JSON.stringify(payload));
    const baseUrl =
      this.config.get<string>('TRY_ON_LOCAL_PUBLIC_URL')?.trim() ||
      `http://localhost:${this.config.get<string>('PORT') || '3000'}`;
    const base = new URL(baseUrl);
    if (
      base.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
      base.username ||
      base.password ||
      base.pathname !== '/' ||
      base.search ||
      base.hash
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    return new URL(`/api/try-on/local-assets/${token}`, base).toString();
  }

  public async getSignedObject(token: string): Promise<{
    body: Buffer;
    mimeType: string;
  }> {
    try {
      this.assertEnabled();
      if (!TOKEN_PATTERN.test(token) || token.length > 2048)
        throw new Error('invalid token');
      const payload = JSON.parse(
        this.decrypt(token),
      ) as Partial<DownloadPayload>;
      if (
        typeof payload.key !== 'string' ||
        !KEY_PATTERN.test(payload.key) ||
        !Number.isSafeInteger(payload.expiresAt) ||
        (payload.expiresAt as number) <= Math.floor(Date.now() / 1000) ||
        (payload.expiresAt as number) > Math.floor(Date.now() / 1000) + 3600
      )
        throw new Error('invalid token');

      const extension = payload.key.split('.').at(-1);
      const mimeType = extension ? EXTENSION_MIME[extension] : undefined;
      if (!mimeType) throw new Error('invalid token');
      return { body: await this.storage.get(payload.key), mimeType };
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  public async deleteObject(objectKey: string): Promise<void> {
    this.assertKey(objectKey);
    try {
      this.assertEnabled();
      await this.storage.delete(objectKey);
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
      input.body.byteLength === 0 ||
      input.body.byteLength > MAX_OBJECT_BYTES
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    const extension = MIME_EXTENSION[input.mimeType];
    if (!extension) throw new ServiceUnavailableException(UNAVAILABLE);
    const key = `try-on/${input.userId}/${kind}/${input.id}.${extension}`;
    try {
      this.assertEnabled();
      await this.storage.put(key, input.body);
      return key;
    } catch {
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  private encrypt(value: string): string {
    const secret = this.config.get<string>('JWT_SECRET')?.trim();
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException(UNAVAILABLE);
    const key = createHash('sha256').update(secret).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  private decrypt(token: string): string {
    const secret = this.config.get<string>('JWT_SECRET')?.trim();
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException(UNAVAILABLE);
    const [encodedIv, encodedCiphertext, encodedTag] = token.split('.');
    if (!encodedIv || !encodedCiphertext || !encodedTag)
      throw new Error('invalid token');
    const iv = Buffer.from(encodedIv, 'base64url');
    const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
    const tag = Buffer.from(encodedTag, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid token');
    const key = createHash('sha256').update(secret).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  private assertEnabled(): void {
    if (
      this.config.get<string>('TRY_ON_STORAGE_DRIVER') !== 'local' ||
      this.config.get<string>('NODE_ENV') !== 'development'
    )
      throw new Error('local storage is development-only');
  }

  private assertKey(key: string): void {
    if (!KEY_PATTERN.test(key))
      throw new ServiceUnavailableException(UNAVAILABLE);
  }
}
