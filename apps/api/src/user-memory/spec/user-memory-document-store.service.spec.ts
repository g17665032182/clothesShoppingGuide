import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import qiniu from 'qiniu';
import { UserMemoryDocumentStoreService } from '../service/user-memory-document-store.service.js';

const userId = '12345678-1234-1234-1234-123456789abc';
const config = {
  QINIU_ACCESS_KEY: 'test-access',
  QINIU_SECRET_KEY: 'test-secret',
  QINIU_BUCKET: 'test-bucket',
  QINIU_DOMAIN: 'https://storage.example.test',
};

function service(
  values: Record<string, string> = config,
): UserMemoryDocumentStoreService {
  return new UserMemoryDocumentStoreService({
    get: (key: string) => values[key],
  } as ConfigService);
}

test('存储适配器隔离七牛调用，支持上传、读取、分页和幂等删除', async (t) => {
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
      ) as {
        scope: string;
        insertOnly: number;
      };
      assert.equal(policy.scope, `test-bucket:${key}`);
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
      assert.ok(deadline <= Math.floor(Date.now() / 1000) + 60);
      return 'https://storage.example.test/signed?token=private';
    },
  );
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      return new Response(uploaded);
    },
  );
  t.mock.method(
    qiniu.rs.BucketManager.prototype,
    'listPrefix',
    async (bucket: string, options: qiniu.rs.ListPrefixOptions | null) => {
      assert.equal(bucket, 'test-bucket');
      assert.deepEqual(options, {
        prefix: 'user-memory/',
        limit: 100,
        marker: 'next',
      });
      return {
        ok: () => true,
        data: {
          items: [
            { key: savedKey, putTime: 17000000000000000 },
            { key: 'user-memory/foreign', putTime: 17000000000000000 },
          ],
          marker: 'following',
        },
      } as never;
    },
  );
  t.mock.method(qiniu.rs.BucketManager.prototype, 'delete', async () => {
    return { ok: () => false, resp: { statusCode: 612 } } as never;
  });

  const store = service();
  const key = await store.putRevision(userId, 2, '中文 memory');
  assert.match(key, new RegExp(`^user-memory/${userId}/2-[0-9a-f-]+\\.md$`));
  assert.equal((await store.readObject(key)).toString('utf8'), '中文 memory');
  assert.deepEqual(await store.listObjects('next'), {
    items: [{ key, uploadedAt: new Date(1700000000000) }],
    marker: 'following',
  });
  await store.deleteObject(key);
});

test('配置、键和上游故障均返回不含敏感信息的 503', async (t) => {
  const store = service();
  const key = `user-memory/${userId}/1-12345678-1234-1234-1234-123456789abc.md`;
  const safeError = (error: unknown) =>
    error instanceof ServiceUnavailableException &&
    error.message === '记忆文档存储暂不可用' &&
    !JSON.stringify(error.getResponse()).includes('private');
  await assert.rejects(
    service({}).putRevision(userId, 1, 'private'),
    safeError,
  );
  await assert.rejects(
    store.putRevision('../private', 1, 'private'),
    safeError,
  );
  await assert.rejects(store.putRevision(userId, 0, 'private'), safeError);
  await assert.rejects(store.readObject('../private'), safeError);

  t.mock.method(qiniu.form_up.FormUploader.prototype, 'put', async () => {
    throw new Error('private credential');
  });
  t.mock.method(
    qiniu.rs.BucketManager.prototype,
    'privateDownloadUrl',
    () => 'https://private',
  );
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('private timeout');
  });
  t.mock.method(qiniu.rs.BucketManager.prototype, 'delete', async () => {
    return { ok: () => false, resp: { statusCode: 403 } } as never;
  });
  t.mock.method(qiniu.rs.BucketManager.prototype, 'listPrefix', async () => {
    throw new Error('private permission');
  });
  await assert.rejects(store.putRevision(userId, 1, 'private'), safeError);
  await assert.rejects(store.readObject(key), safeError);
  await assert.rejects(store.deleteObject(key), safeError);
  await assert.rejects(store.listObjects(), safeError);
});
