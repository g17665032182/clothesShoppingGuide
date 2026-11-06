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

test('穿衣请求有限召回长期背景，普通请求不额外召回', async () => {
  const f = fixture(
    true,
    '我住在广州，气候湿热\n\n冬季通勤较多\n\n长期爱好是徒步\n\n喜欢阅读小说',
  );
  const context = await f.service.readContext('owner', '推荐冬季通勤衣服');
  assert.match(context, /住在广州/);
  assert.match(context, /冬季通勤/);
  assert.match(context, /徒步/);
  assert.doesNotMatch(context, /阅读小说/);
  assert.ok(context.indexOf('住在广州') < context.indexOf('冬季通勤'));
  assert.equal(await f.service.readContext('owner', '推荐一本小说'), '');
  assert.equal(await f.service.readContext('owner', '推荐早餐搭配'), '');
  assert.equal(await f.service.readContext('owner', '购物清单'), '');
});

test('背景召回保持段落长度预算并跳过超长段落', async () => {
  const f = fixture(true, `住在${'甲'.repeat(2048)}\n\n气候湿热\n\n爱好徒步`);
  const context = await f.service.readContext('owner', '推荐衣服');
  assert.doesNotMatch(context, /甲/);
  assert.match(context, /气候湿热/);
  assert.match(context, /爱好徒步/);
  const content = context.split('\n\n').slice(2).join('\n\n');
  assert.ok(content.length <= 2048);
});

test('穿衣请求可召回当前所在地与近期倾向，保留历史自述和时效限制', async () => {
  const location = '用户曾表示目前在广州海珠区，常住情况未确认';
  const style = '用户曾表达近期穿衣倾向为休闲，未确认长期偏好';
  const size = '上衣尺码为M，偏好棉质面料';
  const f = fixture(true, `${location}\n\n${style}\n\n${size}\n\n喜欢阅读小说`);
  const context = await f.service.readContext('owner', '推荐衣服');
  for (const block of [location, style, size])
    assert.ok(context.includes(block));
  assert.match(context, /可能已变化/);
  assert.match(context, /使用前需结合当前消息确认/);
  assert.doesNotMatch(context, /阅读小说/);
  assert.equal(await f.service.readContext('owner', '推荐一本小说'), '');
});
