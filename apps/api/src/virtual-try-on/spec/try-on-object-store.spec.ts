import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import qiniu from 'qiniu';

import { QiniuTryOnObjectStoreService } from '../service/qiniu-try-on-object-store.service.js';

const userId = '12345678-1234-1234-1234-123456789abc';
const objectId = '22345678-1234-1234-1234-123456789abc';
const config = {
  QINIU_ACCESS_KEY: 'test-access',
  QINIU_SECRET_KEY: 'test-secret',
  QINIU_BUCKET: 'try-on-test',
  QINIU_DOMAIN: 'https://try-on.example.test',
};

function createStore(values: Record<string, string> = config) {
  return new QiniuTryOnObjectStoreService(new ConfigService(values));
}

test('Qiniu 适配器生成隔离键、签名下载并按已不存在对象幂等删除', async (t) => {
  let uploaded: Buffer | undefined;
  let savedKey = '';
  t.mock.method(
    qiniu.form_up.FormUploader.prototype,
    'put',
    async (token: string, key: string | null, body: Buffer) => {
      assert.ok(key);
      savedKey = key;
      uploaded = body as Buffer;
      const policy = JSON.parse(
        Buffer.from(token.split(':')[2]!, 'base64url').toString(),
      ) as { scope: string; insertOnly: number };
      assert.equal(policy.scope, `${config.QINIU_BUCKET}:${savedKey}`);
      assert.equal(policy.insertOnly, 1);
      return { ok: () => true } as never;
    },
  );
  t.mock.method(
    qiniu.rs.BucketManager.prototype,
    'privateDownloadUrl',
    (domain: string, key: string, deadline: number) => {
      assert.equal(domain, config.QINIU_DOMAIN);
      assert.equal(key, savedKey);
      assert.ok(deadline <= Math.floor(Date.now() / 1000) + 300);
      return `https://try-on.example.test/${key}?token=private`;
    },
  );
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      return new Response(uploaded);
    },
  );
  t.mock.method(
    qiniu.rs.BucketManager.prototype,
    'delete',
    async () =>
      ({
        ok: () => false,
        resp: { statusCode: 612 },
      }) as never,
  );

  const store = createStore();
  const key = await store.putPhoto({
    userId,
    id: objectId,
    body: Buffer.from('webp-bytes'),
    mimeType: 'image/webp',
  });
  assert.equal(key, `try-on/${userId}/photos/${objectId}.webp`);
  assert.equal(
    await store.getPrivateDownloadUrl(key, 300),
    `https://try-on.example.test/${key}?token=private`,
  );
  assert.equal((await store.getObject(key)).toString(), 'webp-bytes');
  await store.deleteObject(key);
});

test('Qiniu 适配器拒绝非标准键、错误 TTL、MIME 和非 HTTPS 域名', async () => {
  const store = createStore();
  await assert.rejects(
    store.getObject(`other/${userId}/photos/${objectId}.webp`),
    ServiceUnavailableException,
  );
  await assert.rejects(
    store.getPrivateDownloadUrl(`try-on/${userId}/photos/${objectId}.webp`, 0),
    ServiceUnavailableException,
  );
  await assert.rejects(
    store.putResult({
      userId,
      id: objectId,
      body: Buffer.from('data'),
      mimeType: 'image/gif',
    }),
    ServiceUnavailableException,
  );
  await assert.rejects(
    createStore({
      ...config,
      QINIU_DOMAIN: 'http://storage.example.test',
    }).getPrivateDownloadUrl(`try-on/${userId}/results/${objectId}.png`, 60),
    ServiceUnavailableException,
  );
});
