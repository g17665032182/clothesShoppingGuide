import assert from 'node:assert/strict';
import test from 'node:test';
import { Logger } from '@nestjs/common';
import { RequestContext } from '@mikro-orm/core';

import { UserMemorySchedulerService } from '../service/user-memory-scheduler.service.js';

test('记忆调度故障只记录安全分类，空轮询不重置节流，成功处理后恢复日志', async (t) => {
  const logs: unknown[] = [];
  let timerCallback: (() => void) | undefined;
  let fail = true;
  let empty = false;
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Logger.prototype, 'warn', (message: unknown) => {
    logs.push(message);
  });
  t.mock.method(RequestContext, 'create', ((
    _em: unknown,
    callback: () => Promise<void>,
  ) => callback()) as never);
  t.mock.method(globalThis, 'setInterval', ((callback: () => void) => {
    timerCallback = callback;
    return { unref() {} };
  }) as never);
  const task = { id: 'd930b0b0-ef7a-4baa-b408-0aa834a3d288' };
  const scheduler = new UserMemorySchedulerService(
    {
      recoverExpiredProcessing: async () => 0,
      claimBatch: async () => (empty ? [] : [task]),
      markFailed: async () => undefined,
      markSucceeded: async () => undefined,
    } as never,
    {
      process: async () => {
        if (fail) throw new Error('private credentials and raw body');
      },
      getFailureCode: () => 'MODEL_UNAVAILABLE',
    } as never,
    { em: {} } as never,
  );
  const tick = async () => {
    timerCallback!();
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  try {
    scheduler.onModuleInit();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(logs.length, 1);
    empty = true;
    await tick();
    empty = false;
    await tick();
    assert.equal(logs.length, 1, '无任务轮询不能清除故障节流');
    now += 30_000;
    await tick();
    assert.equal(logs.length, 2);
    fail = false;
    await tick();
    fail = true;
    await tick();
    assert.equal(logs.length, 3, '实际成功恢复后新故障应立即记录');
    assert.doesNotMatch(JSON.stringify(logs), /private|credentials|raw body/);
    assert.deepEqual(logs[0], {
      context: 'UserMemorySchedulerService',
      code: 'MODEL_UNAVAILABLE',
      taskId: task.id,
    });
  } finally {
    await scheduler.onModuleDestroy();
  }
});
