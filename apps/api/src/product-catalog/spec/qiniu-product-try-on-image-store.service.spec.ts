import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import qiniu from 'qiniu';

import { QiniuProductTryOnImageStoreService } from '../service/qiniu-product-try-on-image-store.service.js';

const productId = '12345678-1234-4234-8234-123456789abc';
const assetId = '22345678-1234-4234-8234-123456789abc';
const config = {
  QINIU_ACCESS_KEY: 'isolated-test-access',
  QINIU_SECRET_KEY: 'isolated-test-secret',
  QINIU_BUCKET: 'private-product-test',
  QINIU_DOMAIN: 'https://storage.example.test',
};

test('商品图七牛适配器使用独立私有命名空间并限制可读取对象键', async (t) => {
  let uploadedBody: Buffer | undefined;
  let observedToken = '';
  let observedKey = '';
  let observedDomain = '';
  let observedUrl = '';
  const key = `product-try-on/${productId}/${assetId}.webp`;
  t.mock.method(
    qiniu.form_up.FormUploader.prototype,
    'put',
    async (token: string, actualKey: string | null, body: Buffer) => {
      observedToken = token;
      observedKey = actualKey ?? '';
      uploadedBody = body;
      return { ok: () => true } as never;
    },
  );
  t.mock.method(
    qiniu.rs.BucketManager.prototype,
    'privateDownloadUrl',
    (domain: string, actualKey: string, deadline: number) => {
      observedDomain = domain;
      observedKey = actualKey;
      assert.ok(deadline > Math.floor(Date.now() / 1000));
      return `https://storage.example.test/${key}?token=private`;
    },
  );
  t.mock.method(
    globalThis,
    'fetch',
    async (url: Parameters<typeof fetch>[0]) => {
      observedUrl = String(url);
      return new Response(uploadedBody);
    },
  );

  const store = new QiniuProductTryOnImageStoreService(
    new ConfigService(config),
  );
  assert.equal(
    await store.putImage({
      productId,
      assetId,
      body: Buffer.from('normalized-webp'),
    }),
    key,
  );
  const policy = JSON.parse(
    Buffer.from(observedToken.split(':')[2]!, 'base64url').toString(),
  ) as { scope: string; insertOnly: number };
  assert.equal(observedKey, key);
  assert.equal(policy.scope, `${config.QINIU_BUCKET}:${key}`);
  assert.equal(policy.insertOnly, 1);
  assert.equal((await store.getObject(key)).toString(), 'normalized-webp');
  assert.equal(observedDomain, config.QINIU_DOMAIN);
  assert.match(observedUrl, /token=private/u);
  await assert.rejects(
    store.getObject(`try-on/${productId}/photos/${assetId}.webp`),
    ServiceUnavailableException,
  );
  await assert.rejects(
    store.putImage({
      productId: 'invalid',
      assetId,
      body: Buffer.from('webp'),
    }),
    ServiceUnavailableException,
  );
});
