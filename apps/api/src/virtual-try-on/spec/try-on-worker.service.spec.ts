import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';

import { TryOnPhotoStatus } from '../entity/try-on-photo.entity.js';
import { TryOnTask } from '../entity/try-on-task.entity.js';
import {
  TryOnProviderError,
  type TryOnImageProvider,
} from '../port/try-on-image-provider.port.js';
import type { TryOnObjectStore } from '../port/try-on-object-store.port.js';
import { TryOnImageProcessingService } from '../service/image-processing.service.js';
import { TryOnTaskService } from '../service/try-on-task.service.js';
import { TryOnWorkerService } from '../service/try-on-worker.service.js';

const taskId = '12345678-1234-1234-1234-123456789abc';
const userId = '22345678-1234-1234-1234-123456789abc';
const photoId = '32345678-1234-1234-1234-123456789abc';

function createWorker(provider: TryOnImageProvider, attempts: number[]) {
  const events: string[] = [];
  let currentAttempt = 0;
  const task = Object.assign(new TryOnTask(), {
    id: taskId,
    userId,
    sourcePhotoId: photoId,
    garmentImageUrl: 'https://catalog.example.test/item.webp',
    providerModel: 'test-model',
    attempts: 1,
  });
  const taskService = {
    recoverExpiredProcessing: async () => {},
    claimBatch: async () => {
      const taskAttempts = attempts[currentAttempt];
      if (taskAttempts === undefined) return [];
      task.attempts = taskAttempts;
      currentAttempt += 1;
      return [task];
    },
    scheduleRetry: async (_task: TryOnTask, code: string) => {
      events.push(`retry:${code}`);
    },
    markFailed: async (_task: TryOnTask, code: string) => {
      events.push(`failed:${code}`);
    },
    markSucceeded: async () => {
      events.push('succeeded');
    },
  };
  const worker = new TryOnWorkerService(
    taskService as unknown as TryOnTaskService,
    {
      findOne: async () => ({
        id: photoId,
        userId,
        status: TryOnPhotoStatus.ACTIVE,
        objectKey: `try-on/${userId}/photos/${photoId}.webp`,
      }),
    } as never,
    provider,
    {
      getObject: async () => Buffer.from('person'),
      putResult: async () => `try-on/${userId}/results/${taskId}.webp`,
      deleteObject: async () => {},
      getPrivateDownloadUrl: async () => 'https://private.example.test/signed',
      putPhoto: async () => `try-on/${userId}/photos/${photoId}.webp`,
    } satisfies TryOnObjectStore,
    {
      normalize: async (body: Buffer) => ({
        body,
        mimeType: 'image/webp',
        byteSize: body.byteLength,
        width: 1,
        height: 1,
      }),
    } as unknown as TryOnImageProcessingService,
    new ConfigService({ TRY_ON_PROCESSING_TIMEOUT_MS: 1000 }),
    {} as never,
  );
  Object.defineProperty(worker, 'fetchPublicImage', {
    value: async () => Buffer.from('garment'),
  });
  return { worker, events };
}

test('后台任务只安排一次临时错误重试，第二次失败后转终态', async () => {
  const { worker, events } = createWorker(
    {
      generate: async () => {
        throw new TryOnProviderError('TRANSIENT_PROVIDER_ERROR');
      },
    },
    [1, 2],
  );
  const poll = (worker as unknown as { poll(): Promise<void> }).poll.bind(
    worker,
  );

  await poll();
  await poll();

  assert.deepEqual(events, [
    'retry:TRANSIENT_PROVIDER_ERROR',
    'failed:TRANSIENT_PROVIDER_ERROR',
  ]);
});

test('后台任务不重试供应商拒绝和非法输出', async () => {
  for (const code of [
    'PROVIDER_REJECTED',
    'INVALID_PROVIDER_OUTPUT',
  ] as const) {
    const { worker, events } = createWorker(
      {
        generate: async () => {
          throw new TryOnProviderError(code);
        },
      },
      [1],
    );
    const poll = (worker as unknown as { poll(): Promise<void> }).poll.bind(
      worker,
    );

    await poll();

    assert.deepEqual(events, [`failed:${code}`]);
  }
});
