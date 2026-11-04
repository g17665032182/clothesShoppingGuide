import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';

import { UserMemoryReaderService } from '../service/user-memory-reader.service.js';

function fixture(enabled: boolean, content: string) {
  let documentReads = 0;
  let unavailable = false;
  let forks = 0;
  const manager = {
    transactional: async <T>(
      callback: (tx: typeof transaction) => Promise<T>,
    ) => callback(transaction),
  };
  const transaction = {
    getConnection: () => ({ execute: async () => undefined }),
    getTransactionContext: () => undefined,
    findOne: async () => ({ enabled }),
  };
  const service = new UserMemoryReaderService(
    {
      getEntityManager: () => ({
        fork: () => {
          forks++;
          return manager;
        },
      }),
    } as never,
    {
      get: async () => {
        documentReads++;
        if (unavailable) throw new ServiceUnavailableException();
        return { content, revision: 1, updatedAt: null };
      },
    } as never,
  );
  return {
    service,
    fail: () => {
      unavailable = true;
    },
    counts: () => ({ documentReads, forks }),
  };
}

test('关闭记忆时不读取对象；无关段落不注入', async () => {
  const disabled = fixture(false, '棉质外套');
  assert.equal(await disabled.service.readContext('owner', '棉质'), '');
  assert.deepEqual(disabled.counts(), { documentReads: 0, forks: 1 });
  const enabled = fixture(true, '长期喜欢棉质衣物');
  assert.equal(await enabled.service.readContext('owner', '旅行背包'), '');
});

test('记忆reader只保留相关段落及原顺序，故障交由聊天调用方隔离', async () => {
  const f = fixture(true, '通勤穿着习惯\n\n棉质衣物记录\n\n无关内容');
  const context = await f.service.readContext('owner', '棉质 通勤');
  assert.ok(context.indexOf('通勤穿着习惯') < context.indexOf('棉质衣物记录'));
  assert.doesNotMatch(context, /无关内容/);
  f.fail();
  await assert.rejects(
    f.service.readContext('owner', '棉质'),
    ServiceUnavailableException,
  );
});
